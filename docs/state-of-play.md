# State of play

Where the product actually is, what constrains it, and what to pick up next.

Last updated: 2026-08-24.

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

**Production numbers as of this writing:** 95 findings, 45 fixable, 1 verified, 2 sites with
Search Console verified, 26 rules, 8 deterministic fixers.

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

### The cold start is the worst part of the product

Every first request after a quiet period pays 30 to 60 seconds. `keep-warm.yml` reduces how often
this happens; it cannot eliminate it, because the keep-warm cron and the spin-down window are the
same 15 minutes. The dashboard already handles it honestly rather than showing a broken page. Do
not paper over it further; a sprint demo should wake the service first.

### The worker is a cron, not a daemon

GitHub Actions on a public repo gives unlimited free minutes, and that is the whole reason the
crawler is affordable. The cost is that the worker is ephemeral and runs at most every 15 minutes
(`repository_dispatch` for immediacy, `*/15` as the safety net). **Nothing can assume a process
stays up.** Durability lives in pg-boss, never in memory.

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

### Google's API ceilings

Search Analytics: 25,000 rows per request, ~50,000 page-keyword pairs per property per day, 2 to 3
day lag. URL Inspection: **2,000 per day, 600 per minute, per property**, which is a hard limit and
the reason we prioritise the top 100 pages by traffic plus recent publishes.

---

## What is built and working

- **The rule engine**: 26 deterministic rules across 6 axes, fixture-tested. `performance` and
  `authority` have no rules by design; they are measured by connectors, which is why the scorecard
  honestly shows "Not measured" rather than a zero.
- **The fixers**: 8 deterministic, plus the LLM content fixer for TECH-021. `canFixFinding` is the
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

---

## What is left

### 1. No progress feedback after "Open a pull request"

You click, get a banner saying a PR is on its way, and then **nothing until you manually refresh**.
The work happens on a worker that may not start for up to 15 minutes, so the silence can be long.

`apps/web/components/live-progress.tsx` already solves this and is used on exactly one page
(the audit page). The fix flow never got it. This is the highest-value remaining UI work and it is
mostly reuse.

### 2. `draftOutreach` is unreachable

`packages/agent/src/outreach.ts` is implemented, unit-tested, prompt-snapshotted, exported - and
called by nothing. No route, no job, no UI. **Wire it up or delete it.** Unreachable code that
looks finished is worse than absent code, because a reader assumes the feature exists.

Note the product law if it is wired up: *never auto-send outreach. We draft. Humans send.*

### 3. STORY-038, the eval harness, is two-fifths short (#129)

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

Merge rate and revert rate were impossible until this week because no fix PR had ever been merged.
One now has, so the numbers can start.

### 4. Two open stories

- **#118 STORY-034**: the graded deliverables close. Yours, not mine: the recorded demo, the task
  board link, sharing with `quantic-grader`.
- **#117 STORY-033**: billing. Marked stretch.

### 5. Smaller things

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
