# State of play

Where the product actually is, what constrains it, and what to pick up next.

Last updated: 2026-09-26.

Repair status is tracked in [repair-progress.md](repair-progress.md) and GitHub epic #179. PRs #177 and #178 are merged, migrations through 0024 passed, and post-merge CI passed all 14 browser tests. Older measurements below retain their original dates; container deployment and live-provider acceptance are still open.

This is the "read this first after a break" document. `CLAUDE.md` says what we are building and the
laws it must obey; `docs/architecture.md` says how it is put together. This one says what is true
today, including the parts that are not finished. It is deliberately blunt: a status document that
flatters the project is worse than none, because it is the thing a future session will trust.

---

## The loop closes, and that is new

On 2026-08-24 the full loop ran end to end in production for the first time:

```
crawl -> diagnose -> prioritise -> open a PR -> human merges -> verify in production
```

A TECH-007 finding on `kenya-safari-architect` reached `verified`: the fix PR was merged, the
reconciler noticed, a re-crawl ran, and the re-crawl confirmed the issue was gone. The Search
Console verification for `lakevictoriaaquaculture.com` also completed, three weeks after its PR was
merged.

Until that day both had been stuck. See "the webhook is not a channel you can rely on" below,
because the reason is a permanent property of the free tier rather than a bug that is now gone.

**Production numbers, measured 2026-08-24 and not re-read since:** 95 findings, 45 fixable, 1
verified, 2 sites with Search Console verified. The code-side counts are still current: 31 rules,
9 deterministic fixers, plus the LLM content fixer.

---

## Constraints that are permanent, not bugs

These come from ADR-0006 (everything runs on a free tier, total cost $0). They are the price of
that decision and they are worth re-reading before "fixing" anything below.

### The API sleeps, and that breaks push notifications

Render's free web service spins down after ~15 minutes of inactivity and takes 30 to 60 seconds to
wake. GitHub allows a webhook delivery 10 seconds and does not keep retrying.

**Anything that depends on being told something by an outside system will eventually miss it.**
That is not a hypothetical: it silently broke the last two steps of the loop for weeks. The pattern
that works is *webhook for speed, sweep for truth* - `apps/worker/src/reconcile.ts` is the worked
example, and any future integration that receives callbacks needs the same treatment.

### The cold start is the worst part of the product, and the keep-warm does not fix it

Every first request after a quiet period pays 30 to 60 seconds. Measured on 2026-09-16, a request
to `/health` took **33.6 seconds**.

`keep-warm.yml` was written to make this rare. **It does not work, and the reason is the next
section.** It asks for a ping every 10 minutes against a 15-minute idle window; GitHub actually
runs it every 3 hours or so. The cold start is therefore the normal case, not the rare one. The
workflow is kept because it costs nothing and occasionally helps, but nothing should be built on
the assumption that the API is awake.

The dashboard already handles this honestly rather than showing a broken page. Do not paper over
it further; **a sprint demo should wake the service by hand first.**

### The worker is a cron, not a daemon, and the cron is much slower than it says

GitHub Actions on a public repo gives unlimited free minutes, and that is the whole reason the
crawler is affordable. The cost is that the worker is ephemeral: `repository_dispatch` for
immediacy, a schedule as the safety net. **Nothing can assume a process stays up.** Durability
lives in pg-boss, never in memory.

**The schedules do not run on the cadence they declare.** GitHub de-prioritises scheduled
workflows on repositories with little recent activity, and the effect is large. Measured across
the 30 most recent scheduled runs of each, 2026-09-11 to 2026-09-16:

| Workflow | Declared | Shortest gap seen | Median gap | Longest gap |
|---|---|---|---|---|
| `keep-warm.yml` | every 10 min | 103 min | **179 min** | 352 min |
| `worker.yml` | every 15 min | 105 min | **185 min** | 415 min |

Read the "shortest gap" column first: the *best* case observed was over an hour and a half, which
is seven times the window `keep-warm.yml` needs to hit. This is not jitter around the declared
cadence, it is a different cadence.

What still works is `repository_dispatch`, which is not a schedule and fires promptly. So a user
action that enqueues a job is fine; it is the unattended safety net that is slow.

**Scheduled workflows are disabled entirely after 60 days with no repository activity.** Any
commit resets the clock. Before a break, note that the worker will stop running on its own roughly
two months after the last commit, and CI will stay green the whole time, because nothing about a
disabled schedule is a test failure.

### One Postgres does everything

Data, queue (pg-boss), vectors (pgvector), and compressed crawl artefacts, all in Neon's free tier,
addressed only by `DATABASE_URL`. No Redis, no object store. Neon also sleeps: a first connection
after a quiet period can take a while, which is why local scripts against it use a 120s connect
timeout.

### Migrations do not follow the code automatically

`drizzle-kit generate` diffs against a snapshot that stopped being updated at 0006, so it emits a
cumulative migration that tries to re-create existing tables. **Every migration since is
hand-written and hand-registered in `meta/_journal.json`.** `packages/db/test/migrations.test.ts`
catches the forgotten journal entry. `.github/workflows/migrate.yml` applies them on merge to main;
before it existed, a missing ALTER TABLE took production down for hours with every check green.

### DataForSEO's API password is not its login password

The vendor issues a separate API password at `app.dataforseo.com/api-access`. Authenticating with
the dashboard login password returns status 40100, "you are not authorized to access this
resource", on every endpoint, which looks exactly like a broken integration. Check this first if
the authority axis reports referring domains as unmeasured while the credentials look present.

### Google's API ceilings

Search Analytics: 25,000 rows per request, ~50,000 page-keyword pairs per property per day, 2 to 3
day lag. URL Inspection: **2,000 per day, 600 per minute, per property**, which is a hard limit and
the reason we prioritise the top 100 pages by traffic plus recent publishes.

---

## What is built and working

- **The rule engine**: 31 deterministic rules across 6 axes, fixture-tested. `performance` and
  `authority` have no rules by design; they are measured by connectors, which is why the scorecard
  honestly shows "Not measured" rather than a zero.
- **The fixers**: 9 deterministic, plus the LLM content fixer for TECH-021. `canFixFinding` is the
  single authority on whether a PR can be opened, and `runAudit` derives the stored `fixable` from
  it rather than copying the rule's claim.
- **The write path**: GitHub App, branch-per-finding, PR bodies carrying evidence, expected effect,
  falsification and rollback. Never writes to a base branch; the `GitHubApi` port grants no such
  capability.
- **The verify path**: webhook plus reconciler, sharing one transition function so they cannot
  disagree.
- **The web app**: 6 grouped nav sections, findings inbox filtered and paginated in SQL, eight-axis
  scorecard, keywords, authority, AI visibility.
- **The eval harness** (`packages/eval`): precision, recall, hallucination rate, judge-independence
  check, and a documented labelling method.
- **MCP server** (`apps/mcp`): exposes the product to an external agent. Writes are off unless
  `SEO_MCP_ALLOW_WRITES=1`, capped by `SEO_MCP_MAX_PRS`.
- **Progress on both slow actions** (#146): `usePolledProgress` backs the audit page and the fix
  flow, so clicking "Open a pull request" no longer produces a banner and then silence. It says
  "queued" until a runner claims the job, because until then nothing is actually happening, and it
  gives up after five minutes rather than polling a schedule measured in hours.
- **Outreach drafting, reachable** (#147): the authority axis drafts a pitch per unlinked mention.
  The client supplies the one concrete fact, because that is the input we cannot generate
  honestly, and nothing anywhere in the path can send. This was the first LLM call the API makes
  rather than the worker; it is behind the same per-tenant budget guard, and it is synchronous
  because a paragraph a human is about to edit is not worth a worker start.

---

## What is left

### 1. STORY-038, the eval harness, is two-fifths short (#129)

| Criterion | State |
|---|---|
| Runner, precision / recall / hallucination rate | done (#136) |
| Judge on a different model family, asserted | done (#136) |
| Prompt snapshot tests | done (#137) |
| Golden dataset of ~50 pages | **4 pages, 1 case** |
| Production merge rate and revert rate | **not started** |

The dataset is the real work and it is slow rather than hard: capture, read the raw HTML, label
with a `why`, then a second pass over whatever the engine raised that you did not label. The method
is in `packages/eval/README.md` and the one rule that matters is **never label from engine output;
use it only as a reason to go and look.**

Merge rate and revert rate were impossible until a fix PR had been merged. One has, so the numbers
can start.

### 2. Two open stories

- **#118 STORY-034**: the graded deliverables close. Re-verified 2026-09-16: the deployed link,
  the task board link, the design document and the `quantic-grader` share are all in place, so
  **the recorded demo is the only item left**, and it is yours rather than the code's.
- **#117 STORY-033**: billing. Marked stretch, and the only one of the two that is code.

### 3. A researched roadmap, one item in

**Done (2026-09-20):** Tier 1 item 1, the two Search Console content findings. CONTENT-001 raises
queries where two of the site's own pages split the impressions; CONTENT-002 raises questions the
site is shown for with no page answering them, matched against crawled titles and H1s. Both are
deterministic, cost nothing, and are unmeasured rather than empty when Search Console is not
connected. The content coverage note no longer claims cannibalisation is unmeasured.

**Done (2026-09-20):** Tier 1 item 2, local business identity. A Maps share link is decoded into a
CID and Place ID (host allow-listed, redirects followed by hand), stored per site, and LOCAL-002
opens a pull request that adds `hasMap` and `sameAs` to an existing LocalBusiness block rather
than adding a second one. LOCAL-003 raises a phone number in the markup that no number on the page
matches (compared on the last nine digits, so one number written two ways is not drift) and
LOCAL-004 raises a connected profile the site never links to. Both are findings rather than pull
requests: which phone is right is a fact only the business knows, and adding visible links is a
design decision.

**Done (2026-09-20):** Tier 1 item 3, product pages. PROD-001 raises a page that is evidently
selling something whose structured data cannot produce a merchant listing, naming the missing
properties; PROD-002 raises a marked-up price that appears nowhere in the page text, compared
numerically so formatting is never mistaken for a mismatch. The planned PROD-003 was dropped
because TECH-012 already finds near-duplicate copy. No word-count rule and no FAQ schema advice
was built, because neither survives contact with the primary sources.

**Done (2026-09-21):** Tier 2 item 4, the classified link gap. DataForSEO is configured and live
(balance about $0.89 at the time of writing, so the ceiling is low). AUTH-005 names publications
that link to every tracked competitor and not to this site, after refusing link farms by the
vendor's spam score and routing directories to the local axis. The first live query returned
fifteen domains and refused all fifteen, which is the honest answer and the reason the
classification exists.

**Done (2026-09-21):** Tier 2 item 5, the keyword gap. A competitor's rankings from the vendor,
with every query the site already draws impressions for subtracted using its own Search Console
data, on `/keywords`. The subtraction is best-effort and its absence is reported rather than
passed off as a clean gap. `siteQueries` in `packages/audit/src/search.ts` is the shared way into
a tenant's Search Console, extracted from `measureSearch` for this.

**Done (2026-09-21):** Tier 2 item 6, question mining. Search Console's question queries plus
People Also Ask, grouped by subject, on `/visibility`, where a selection becomes tracked prompts.
The embedding clustering and the geographic scope tagging were deliberately left out; the research
document says why. The API composes a SERP provider for the first time: every other SERP call in
the product runs on the worker, and this one is interactive like the outreach drafter.

**Tier 2 is complete.**

**Done (2026-09-21):** Tier 3 item 7, the topic map, under ADR-0024. Embeddings are the
instrument, the grouping is deterministic, and the model only labels groups that already exist;
two runs over one crawl produce the same map, asserted by a test. **The `embed` role finally has a
caller**, which had been recorded here as a loose end since Sprint 3. Vectors are not persisted and
pgvector stays unused, which corrects a claim the stack documents have carried since Sprint 1:
nothing queries vectors across audits, so a vector column would be storage with no reader.

Still to do on that item: the cluster findings (a cluster with no internal hub, a tracked prompt
with no matching cluster). The map currently adds no checks to any axis for exactly that reason.

**Done (2026-09-21):** Tier 3 item 8, the public check, under ADR-0025. `POST /check` and
`GET /check/:id` are the only anonymous routes in the API and the only ones that run with no
tenant. `/check` on the web app shows the eight-axis breakdown with the evidence for every
finding, and no score out of 100.

Two things about it worth knowing before changing anything:

- **`public_checks` has RLS enabled and forced with no policies at all.** `seo_app` can read no
  row; the only way in is `asOwner`, whose role carries BYPASSRLS. So a signed-in tenant cannot
  enumerate the URLs strangers have checked, and the schema keeps its every-table-protected
  invariant rather than being allow-listed out of it.
- **The SSRF guard is one function** (`packages/connectors/src/http/public-fetch.ts`) and must
  stay one. It resolves DNS before fetching, refuses a name that answers with any private
  address, re-checks every redirect hop, and caps bytes and time. Its tests are written as the
  attacks they defend against.

**Done (2026-09-21):** Tier 3 item 9, contributor opportunities, reframed as mention building
(ADR-0018's evidence, rule 7's constraint). Every candidate page is read before it is shown, and
selling beats inviting whenever both appear, which is the property that makes the list safe: paid
link sites optimise for "write for us" precisely because that is what their customers search for.

One thing it taught about this suite: **the anonymous check's rate limiter is stateful**, so the
API tests were failing on their own leftovers from previous runs. The limits are now injectable,
the tests clear only their own IP hash, and the per-IP refusal has a test of its own.

**Not started:** Tier 3 item 10 (#172), competitor watch.

`docs/competitive-research-heytony.md` studies the HeyTony tool suite (link gap, question mining,
keyword gap, CID finder, topic map, report card) and plans ten items in three tiers. Tier 1 is free
and deterministic: Search Console cannibalisation and question findings, local business identity as
a pull request, and product page rules. The public `/check` page is approved in principle and
**needs its ADR, amending ADR-0009, before any code**.

### 4. Smaller things

- `packages/db/src/schema/tables.ts` is 525 lines, the largest source file in the repo now that
  `apps/api/src/app.ts` is split. A schema file is a more defensible place for length than a route
  file was, but it is worth a look.
- The `judge` role has infrastructure and no caller.
- TECH-018 (renders nothing without JavaScript) can never fire against the eval dataset, because
  captured cases store served HTML and have no browser. Storing a rendered snapshot alongside the
  raw bytes is the obvious extension.

---

## Traps worth remembering

Each of these cost real time in a previous session.

- **A green test suite can mean less than it looks like.** `vitest` does not typecheck. Adding a
  method to an interface broke a test fake and the suite still passed; `pnpm typecheck` caught it.
  Run both.
- **A snapshot test passes on its first run by definition**, because that run writes the snapshot.
  Mutation-test it once or it proves nothing.
- **`head` and `grep` in a pipeline swallow the exit code.** `npx tsc ... | head -8 && echo CLEAN`
  prints CLEAN for a failing typecheck.
- **Absolute dates in tests age out.** A visibility test computed a window from `now` and compared
  against fixed July dates; main was red for ten days, and a second test in the same file was
  passing for the wrong reason.
- **"Closes" in a PR body closes the issue**, even mid-sentence. "Closes one more acceptance
  criterion of #129" closed #129.
- **Look at the screens.** Two real UI bugs this month were invisible to the type checker, the
  linter and eleven e2e assertions, and visible immediately in a screenshot. Run
  `pnpm --filter @seo/web screens`. Every capture waits for an `h1` first, because it used to
  photograph loading skeletons.
- **Never seed the e2e fixtures into production.** The seed writes a tenant whose API token is a
  public literal in this repo. Use a scratch database and drop it afterwards.
