# State of play

Where the product actually is, what constrains it, and what to pick up next.

Last reviewed: 2026-10-10.

**What shipped on 2026-10-10: one table, an interface that answers, and our own site held to our own rules (#336 to #339).** Every list of records is the shared `<DataTable>` (ten rows a page, a count, no footer when it fits; `stack` for phones), and the three tick-lists of suggestions are one `<PickTable>`. Each page's tables live in a `*-tables.tsx` beside it. The findings inbox is the one exception, because its filters and paging are in the address so a view can be linked. `app/motion.css` adds press feedback, eased colour, an entrance and exit for the dialog sheet, hover only for real pointers, and a reduced-motion mode that keeps fades; colours and fonts did not change. **Our own audit, pointed at our own site, would have raised five findings, and they are fixed and held by `e2e/own-seo.spec.ts`:** every page inherited the homepage's canonical from the root layout (TECH-023), about twenty pages shared one title (TECH-012), the landing page skipped from h1 to h4 (TECH-011), there was no llms.txt (AGENT-001), and robots.txt disallowed `/check/` results that also said noindex, which hides the noindex from the crawler it is addressed to. The sitemap now lists both public pages and carries no invented `lastmod`. Cleanup: `lib/format.ts` replaces seven copies of `hostOf` and ten date formatters (one of which printed `10/10/2026, 12:25:44 PM`), `packages/api-client` is split into `errors.ts`, `types.ts` and the client (1,175 lines to 550), and `classical.css` is an index of five files. Knip reports no unused files and no unused functions; about forty symbols are exported and used only in their own file, which is untidy and harmless and was left. **Not done:** the long backend files (`packages/audit/src/run.ts`, `packages/db/src/schema/tables.ts`, `queries.ts`) were not split, because a mechanical split of the audit run or the schema is a change to verify against production data, not a tidy-up. There is still no Open Graph image.

**What shipped on 2026-10-06 and 2026-10-07, from using the product on two real sites.** The agent opened its first real pull request (kenya-safari-architect #27) after three fixes to the model chain: a retired model and a busy one now fall through, and a "try again in N seconds" is waited out instead of failing. **Audits are a history** (`/audits`, `GET /sites/:id/audits`, `GET /audits/:id/changes`): every run is listed and each says what was resolved and what is new since the one before, by finding identity. **Several pull requests in one request** (`POST /sites/:id/fixes`, ten at a time, still one pull request per finding). **Connect to Vercel** by consent (ADR-0033): one button when the operator has registered an integration (`docs/vercel-integration.md`, four `VERCEL_INTEGRATION_*` variables on the API), and either way the project is found from the repository, so the token form no longer asks for a project id. Also fixed: the profile page crashed for every signed-in person (a helper exported from a client file), and topic names repeated (now made distinct in code). **Operator action outstanding: register the Vercel integration, or the button is not shown.**

**Also on 2026-10-07: the interface was rebuilt on the Stitch structure, and the test database gained a tenant with history.** The palette and fonts are unchanged; `docs/DESIGN.md` describes the new shell (a top bar on every signed-in page, a carded sidebar) and components (`.frame`, `.panel-foot`, `.card-foot`, `<Stat tone>`). The Stitch mock-ups contain a single health score, version tags and sample figures; none of those were built, deliberately. `packages/audit/src/seed-showcase.ts` seeds a second tenant with two audits, pull requests at every stage, citation checks, authority figures, spend and competitor changes, all written by the real code paths, so populated screens can be looked at: `pnpm --filter @seo/web screens` captures them, and the token is `seo_e2e_showcase_token_do_not_use_in_production`. The original e2e tenant is untouched and stays sparse on purpose. **Competitor watch shipped the same day (ADR-0034), see Tier 3 item 10 below.**

**The topic map runs on Google's embedding model (ADR-0032).** The OpenAI account is inactive, so every audit had been skipping the topic map. `LLM_EMBED` is now `google:gemini-embedding-001`, and `LLM_SMART` has `google:gemini-2.5-flash` after the first Groq model so an agent request Groq calls too large is retried there at full size. The grouping threshold is per embedding model (0.88 for Google, chosen from the `calibrate-topics` workflow's output); an uncalibrated model is flagged as provisional in the coverage note. The text embedded is now each page's own content (`extract.mainText`), because the opening of a body turned out to be the menu. Keep `LLM_EMBED` to one model. Render's copies of `LLM_SMART` and `LLM_EMBED` are set by hand and must match the GitHub variables.

**The agent's context shrinks to fit the model (ADR-0031).** Running the agent's file selection against the two real repositories, with no model, showed the prompt was about 19,000 tokens while the free-plan `smart` models commonly accept about 8,000 a minute, so every agent fix would have been refused for size. The context now has three sizes and steps down when a provider says a request is too large; a size refusal also falls through the model chain; and the reason on the finding is the provider's own words. On a small plan the agent can fix what lives in short shared files and says plainly when a long page file is what it could not be shown. The remedy that keeps cost at zero, a Google model in the `smart` chain, was applied on 2026-10-06.

**The agent now reads the repository (ADR-0030, migration 0031).** Until this change a pull request was possible for 11 of the 44 rules, because every fix had to be a hand-written fixer, and everything else was labelled "Needs you". Thirteen more rules are now fixed by an agent in `packages/agent`: a deterministic selector lists the repository, picks at most 14 files that bear on the finding, refuses environment files, workflows, keys and anything holding a credential, and the `smart` model returns find-and-replace edits that are validated before a pull request opens. It is tried last, after the registry and the meta-description writer. A proposal that edits a file it was not shown, matches ambiguously, deletes half a file or adds an unknown hostname opens nothing, and the reason is stored on the finding. **No test calls a real model, so the model half is unproven until a Fix click in production; watch the merge and revert rate of agent pull requests.** Findings the agent cannot take say why in one of four ways (outside your code, your decision, needs your content, bigger than a patch) from `apps/web/lib/manual-reason.ts`. The audit page no longer lists findings; it links to the inbox. A merged pull request whose webhook was lost is now noticed when its finding is read (#286).

PR #268 added host-independent deployment reports and passed production release checks. A subsequent worker inspection found GitHub denying deployment lookup access before origin evidence could be evaluated. Issue #269 tracks App Deployments read permission and safe, actionable finding errors. Do not treat a successful worker workflow as a successful finding verification; the demo finding remains merged and unverified.

PRs #261, #263, #264, and #266 are merged. Migration 0028 preceded the release; production API, web, queue dispatch, audit, PR creation, closed-PR recovery, and a one-line deployed sitemap fix were checked. Vercel evidence lookup is implemented, but its configured live acceptance remains open in #265/#262. Host-independent pipeline reporting and non-Vercel acceptance are tracked in #267; see [hosting-independent-deployments.md](hosting-independent-deployments.md). See [deployment-evidence.md](deployment-evidence.md) for configuration, exact evidence, and the checks that are still incomplete.

The Vercel path passed live acceptance on the operator's own site (#265 closed) using a worker-wide `VERCEL_TOKEN`, which could never have worked for another customer. That token is gone: each site now connects its own Vercel project in Settings, Connections (migration 0029, ADR-0028), validated before it is stored, encrypted, bound to that tenant and site, and never returned. **The operator's own site must be connected through the same form before its fixes verify again.** A site on any other host uses GitHub deployment reports and stores no credential.

Findings now have an identity across audits (migration 0030, ADR-0029): a fingerprint of the rule and what the finding is about. An audit carries forward when an issue was first seen and a won't-fix decision. A pull request is not copied onto the newer finding; the newer one links to it, shows "Fix in progress", and the API refuses a second fix with 409. A verified fix that returns shows as "Back after a fix". Still open under #179: production crawl checkpoints.

The rule engine has 44 rules. Eleven were added on 2026-10-05 (TECH-034 reports images heavier than 300 KB from their declared size, on the content axis so it can never lower a performance score set by real visitors; TECH-032 and TECH-033 check that pages fit a phone, the second by rendering a sample of five pages at 375 pixels wide; TECH-024 to TECH-031: missing and over-long titles, missing and shared meta descriptions, generic link text, thin pages, awkward addresses, dead links to other sites), each raising one finding per site rather than one per page. The crawl now checks up to 100 distinct outbound links after reading the site (`packages/crawler/src/crawl/outbound.ts`), through the egress guard, and reports only links that are certainly gone. [course-coverage.md](course-coverage.md) maps a standard SEO syllabus onto the rules, including where the audit deliberately disagrees with it (word-count targets, keyword density, schema as a ranking factor).

The readiness implementation is documented in [readiness-completion-2026-10-03.md](readiness-completion-2026-10-03.md), with the earlier independent assessment in [readiness-review-2026-10-03.md](readiness-review-2026-10-03.md). Use those for current capability and release gates. Historical production measurements below retain their dates. The new lifecycle regressions do not constitute a fresh live deployment acceptance.

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
verified, 2 sites with Search Console verified. Those historical code counts are superseded: the current registry has ten deterministic fixers plus the model-assisted content fixer. See the readiness capability matrix for verification support.

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
- **Onboarding and site setup**: a new account lands on `/onboarding`, five steps ending in the
  first audit, and an address typed on the landing page is carried through sign-in in a one-hour
  cookie. The brand name is read from the homepage title when the site is added
  (`brandFromTitle`, which returns nothing when the title does not plainly state it). Competitors
  are suggested by one `smart` call from the offering and market, and every candidate is fetched
  before it is shown, so a domain the model invented never reaches the screen. The same forms
  live on `/site`, which is now the one place for brand, offering, market, competitors and
  connections; the dashboard carries a one-line count that links there.
- **One shape for errors**: `act()` in `apps/web/lib/action.ts` returns `ActionResult`, and
  `<ErrorNote>` shows it, with a title and a way forward. Every form that reports a failure in
  place uses it. Actions that redirect (start an audit, connect Google or a repository, verify
  ownership, open a pull request, pay, revoke a session) carry a status in the address and land
  on `<OutcomeNote>`, which has the same title-then-detail shape, so there is one thing to look
  for whichever way a result arrives.
- **Authority** is four figures and one "who to contact" section: three tabs ordered by how likely
  a reply is, one action per row, and a single email composer in a `<dialog>` that remembers the
  fact between publications. It still cannot send; the draft is copied or opened in the person's
  own mail program.
- **The API's outer defences** (ADR-0038, `apps/api/src/protect.ts`): rate limits counted per
  account for signed-in requests and per address otherwise, security headers on every response,
  CORS closed unless an origin is named, request size and time bounds. `RATE_LIMIT_SCALE`
  tightens or widens every limit at once. The web app sends a content security policy from
  `next.config.mjs`. `SECURITY.md` is the list of what is in place and what is knowingly not.
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

### 1. STORY-038, the eval harness (#129): the criteria are met; the sample is narrow

| Criterion | State |
|---|---|
| Runner, precision / recall / hallucination rate | done (#136) |
| Judge on a different model family, asserted | done (#136) |
| Prompt snapshot tests | done (#137) |
| Golden dataset of ~50 pages | done: 50 pages, 3 real sites, 232 claims; precision 100%, recall 97.9%, pinned in CI |
| Production merge rate and revert rate | **built**; shown per site on Outcomes |

The dataset is the real work and it is slow rather than hard: capture, read the raw HTML, label
with a `why`, then a second pass over whatever the engine raised that you did not label. The method
is in `packages/eval/README.md` and the one rule that matters is **never label from engine output;
use it only as a reason to go and look.**

Merge rate and revert rate are recorded on `fix_attempts` (migration 0027): each agent PR is marked
merged or closed unmerged in the same transaction that moves its finding, by the webhook or the
reconciler. A revert is a merged PR on a `revert-<n>-seo-agent/...` branch, which is what GitHub's
Revert button creates; the reconciler also looks for one for 30 days after each merge. A revert made
by hand (`git revert` pushed to main) is not seen here; post-merge verification catches the issue
returning instead. PRs closed unmerged before 0027 left no trace and are not counted.

### 2. Two open stories

- **#118 STORY-034**: the graded deliverables close. Re-verified 2026-09-16: the deployed link,
  the task board link, the design document and the `quantic-grader` share are all in place, so
  **the recorded demo is the only item left**, and it is yours rather than the code's.
- **#117 STORY-033**: billing. **Done (2026-10-07)** under ADR-0036, as far as code can take it.
  A plan sets the monthly cap on paid work and nothing else; the rail is behind `BillingProvider`
  with a Stripe adapter that refuses anything but a test key; only a signature-verified webhook
  changes a plan. **It is off in production and stays off until an operator sets
  `STRIPE_SECRET_KEY` (a test key) and `STRIPE_WEBHOOK_SECRET` on the API and points a Stripe
  test webhook at `/webhooks/billing`.** Until then every account is on the free plan and the
  account page says so. Going live is deliberately out of scope: see the ADR.

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

**Done (2026-10-07):** the map's findings, under ADR-0035. TOPIC-001 raises a group of three or
more pages in which no page links to at least half of the others, counted from the crawl's own
links. TOPIC-002 raises a tracked AI-visibility question whose subject words appear in no crawled
title or main heading. Neither is decided by a vector or reads a cluster's name, and neither is
fixable by a pull request. Each adds one check to its axis only when it could run. The planned
"tracked prompt with no matching cluster" became a word test on purpose: the clustering threshold
is calibrated for page against page, not question against page.

`/topics` (2026-10-07) shows the map and the advice it produced together: the groups from the
last audit, the TOPIC findings that audit raised, and each group's pages on request. It measures
nothing itself, and when the map was not measured it says why instead of drawing an empty one.

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

**Done (2026-10-07):** Tier 3 item 10 (#172), competitor watch, under ADR-0034. A weekly sweep on
the worker (scope `watch-competitors`) reads up to a dozen public pages per tracked competitor
through the SSRF guard, honours their robots.txt, and records what differs from the reading
before: titles, meta descriptions, first H1s and URLs new to their sitemap. `/competitors` shows
each batch beside that competitor's AI citations in the seven days before and after.

Three things about it worth knowing before changing anything:

- **The page states an order of events and never a cause.** The sentence is written by one
  function (`apps/web/lib/citation-sentence.ts`) whose test fails on any causal word or
  percentage. That test is the story's falsification condition; do not route around it.
- **Storage is bounded by what is tracked.** Two snapshots per competitor, enforced on every
  write, and changes pruned at 180 days. Do not add a reader that needs an older snapshot.
- **The read route fetches nothing, and there is no refresh button on purpose.** A request that
  makes the API call a caller-chosen host on demand is request forgery with a nicer name.

Not built: correlation per tracked question. It is the sharper claim and needs a weekly sample
per question that a daily poll on two engines does not give yet.

**Tier 3 is complete.**

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

- **On a route with a `loading.tsx`, a page does not reliably update in place after a server
  action.** Measured on 10 October: the save is stored, the API answers with the new data, the
  server renders the right page and the browser reads all of it, and the router then shows it
  about half the time. `router.refresh()` after the action and `revalidatePath` inside it both
  behave this way; with the route's loading file removed, the update landed 9 times out of 9.
  It shipped twice before it was seen: "Not us" on the authority page, and "Add competitor" on
  the competitors page, where the new competitor failed to appear 8 times out of 9 on a
  populated account while its test passed on an empty one. Both now reload the page, which was
  right every time. The loading files stay, because they are what a reader sees while the API
  wakes. **A single passing run proves nothing here**, so the test for it runs three rounds on
  the account with history. Routes with a loading file: authority, competitors, dashboard,
  findings, keywords, topics, visibility. On those, show a save's result from what the action
  returned, or reload; do not rely on the server-rendered part of the page changing by itself.

- **The local test database is empty after every Docker restart.** It keeps its data in memory
  on purpose (`compose.test.yml`), so when Docker stops, the schema goes with it. The browser
  suite used to answer that with "Process from config.webServer was not able to start". Run
  `pnpm test:db`: it checks Docker is up, starts the container and applies the migrations, and
  its address is fixed in the script so it cannot be pointed at the real database by a stray
  variable. The suite now names that command itself when the database is not answering. Also:
  the first run after Docker starts is slow enough to time tests out. Run it again before
  believing a failure.

- **A search engine answers the question it thinks was asked.** The authority axis searched for
  a client's brand in quotes and counted every result. Google read "Heartbeest" as a misspelling
  of "hartebeest" and returned another company, and the product reported six sites, six pitches
  and a finding about a business that was not the client's. A result is now a mention only if
  its title, summary or address contains the name as written (ADR-0039, `confirmMentions`).
  Anything else that takes a third party's result set as fact needs the same check.

- **There are two monthly caps, and "allowance used up" can mean either.** Each account has its
  own (`tenants.monthly_budget_micros`, shown under Settings, Account), and the whole deployment
  shares one (`GLOBAL_MONTHLY_BUDGET_MICROS`, set on Render and again as a GitHub Actions variable
  for the worker). On 8 October raising every account by ten dollars changed nothing, because the
  shared cap was the one reached: spent plus held across all accounts was 4.997 dollars. The
  refusal now says which cap it was. Raising the shared one is an environment change, not a
  migration.
- **A failed model call holds its reserved cost until somebody settles it.** That is deliberate
  for a failure that might have been billed (a timeout, a 5xx). A call the provider refused
  outright with a 4xx is now released automatically, since nothing ran. The paid search
  providers (`serp`, `keywords`, `backlinks`) reserve the same way and were not changed. Holds
  from before the fix stay until an operator settles them at zero through `recordSpend`.

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
