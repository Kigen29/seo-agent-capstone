# Design and Testing Document

**Project:** Rankwright, an autonomous SEO agent
**Programme:** Quantic School of Business and Technology, MSSE Capstone
**Scope of this document:** the design and architecture decisions, the software and architectural patterns used, the deployment options with their cost implications, and the testing carried out. It is generated from the ten Architecture Decision Records in `docs/adr/`, the architecture map in `docs/architecture.md`, the CI configuration, and every test in the repository.

---

## 0. What the system is, in one paragraph

Every AI-visibility platform on the market is a dashboard: it measures the problem and leaves the fixing to a human who usually cannot write code. Every technical SEO crawler produces four hundred findings and hands them to a marketer. Rankwright closes that loop. It connects to a client's Git repository, audits eight independent surfaces of their search presence, and opens pull requests that fix what it found. The positioning is one sentence: *every other AI-SEO tool sends your marketer a list; we send your repo a pull request.* The design decisions below all serve that single differentiator, and the testing all serves one claim: that when we say "we found fourteen issues," we can prove each one.

---

## 1. Design and architecture decisions

This section addresses rubric requirement 1: the design and architecture decisions made, including technologies and architectural choices, and the reasons for them.

### 1.1 The most important decision: deterministic detection first, LLM second (ADR-0001)

The name "AI SEO agent" invites an obvious architecture that is also wrong: feed the page HTML to a language model and ask it to find the SEO issues. It prototypes in an afternoon and cannot be trusted for a day. Language models hallucinate findings, produce different output on identical input across runs, cost money per page, and cannot be unit tested.

The decision is a hard architectural line. The rule engine (`packages/rules`) contains **zero LLM calls**. A deterministic parser or API client detects every finding. The language model is used only for what is genuinely subjective: explaining a finding in plain language, and writing the code fix. If a check can be expressed as a pure function, it must be.

The reasoning:

- **Reproducibility.** "Is there a canonical tag? Does it resolve to 200? Is LCP above 2.5s at the 75th percentile? Is `OAI-SearchBot` disallowed in robots.txt?" These are parser questions, not reasoning questions. A parser gives the same answer every time; a model does not.
- **Testability.** A pure function reaches 100% unit coverage against fixtures. The rule engine is 65 tests over deterministic inputs, and that is the majority of the product's logic.
- **Cost.** Most of an audit costs nothing but compute. The model is invoked once per *fixable finding*, not once per page. A five-hundred-page crawl with fourteen fixable findings is fourteen model calls, not five hundred.
- **Honesty.** Hallucinated findings, the ones that reference code that does not exist, become structurally impossible for the core checks, because a parser cannot invent a status code it did not see.

This line is drawn on the architecture map and defended everywhere: detection is deterministic, reproducible, and free; fixing is probabilistic and always reviewed by a human. Detection never crosses that line.

### 1.2 The technology stack, and why each part was chosen

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | One install, shared types across ten packages, CI runs once, task caching. |
| Language | TypeScript, strict, NodeNext | One language across web, API, worker, and rules. The `Finding` type is defined once and every package agrees on it. Zod schemas give the same types at runtime that the compiler gives at build time. |
| Web app | Next.js 15 App Router, Tailwind | Server components keep the API token in an httpOnly cookie, off the browser. Deploys free to Vercel. |
| API | Fastify + Zod | Small, fast, and Zod validates every request at the boundary before a query runs. |
| Database | Plain Postgres on Neon | One commodity database, addressed only by `DATABASE_URL`. See 1.8. |
| Queue | pg-boss on the same Postgres | Durable jobs without a second piece of infrastructure. See 1.3 and 1.8. |
| Worker | GitHub Actions on a public repo | Unlimited free minutes, Chromium preinstalled, no execution-time pressure. See 1.3 and 1.8. |
| Crawler | Playwright, Chromium | Renders JavaScript, which is what Google indexes. A raw-HTML fetch would miss client-rendered content. |
| LLM | Role-based, provider-agnostic layer | Swapping a model is an environment edit, never a code change. See 2.2. |
| VCS integration | GitHub App via Octokit | Least privilege, short-lived tokens, auditable. See 1.4. |

### 1.3 Event-driven job queue over synchronous request-response (ADR-0004, ADR-0006)

A full audit crawls up to five hundred pages with a headless browser, calls PageSpeed Insights per template page, pulls Search Console data across several dimensions with pagination, polls several AI engines three times each across several days, and generates code fixes. This takes minutes to days, not milliseconds, and it cannot live inside an HTTP request. External APIs rate-limit us, fail transiently, and impose hard daily quotas (Search Console URL Inspection is capped at two thousand per day per property).

The decision is an event-driven architecture with a durable job queue. The API enqueues, the worker processes, the web app polls the audit row for progress. Jobs are idempotent and resumable, and every job carries a tenant id.

Concretely, and this is the shape verified end to end in the tests: the API creates the audit row as `queued`, puts a job on pg-boss, and fires a `repository_dispatch` to GitHub. A GitHub Actions runner spins up, claims the job, runs the crawl and the rules and the scorecard, and writes the result back. A fifteen-minute schedule drains the queue as a safety net, so a job is never stranded even if the dispatch is missed. The `repository_dispatch` is a nudge to start sooner, never the delivery mechanism: the job is already durable in Postgres, so a failed or absent dispatch means the audit starts a little later, never that it is lost. Retries are bounded and a claimed job is invisible to a second worker, so the schedule and a dispatch firing together cannot run an audit twice.

The rejected alternative was synchronous HTTP: a five-hundred-page Playwright crawl will never complete inside a request timeout. Serverless fan-out was deferred: cold starts and execution-time limits are hostile to Playwright.

### 1.4 GitHub App over personal access token (ADR-0002)

The agent needs write access to a client's repository to open pull requests. Two ways to get it: a personal access token the client generates, or a GitHub App the client installs.

The decision is a GitHub App, requesting the minimum permissions: `contents: write`, `pull_requests: write`, `metadata: read`, `checks: read`, using short-lived per-repository installation tokens. The reasoning is least privilege and auditability. A personal access token is long-lived, usually over-scoped, tied to a human rather than to the integration, and invisible in the organisation's audit log. No security-conscious client would grant one. A GitHub App installation appears in the organisation's audit log, so a client sees exactly what we can touch and revokes it in one click. An OAuth App was rejected because it acts as the user and inherits all of the user's repository access, far broader than we need. Deploy keys were rejected because they cannot open pull requests. All of it sits behind a `VersionControlProvider` interface (see 2.1) so GitLab and Bitbucket can be added without touching the fixer logic.

### 1.5 OAuth per tenant over service account for Search Console (ADR-0003)

Search Console can be reached with a service account or with per-user OAuth. A service account never expires and needs no browser, which is why pipelines reach for it. But a service account has no inherent access to any Search Console property: someone must manually add its email as a user on every single property, and skipping that step is the documented single most common cause of 403 errors on the API. For a multi-tenant product onboarding non-technical clients, that is a support disaster.

The decision is OAuth 2.0 with the tenant's own consent, scopes `webmasters` and `siteverification`, refresh token stored encrypted at rest, scoped to the tenant. We never request or store a Google password. The client clicks one button and it works, with no manual property grants; they can revoke us from their Google account at any time; and the same grant unlocks the differentiating feature, where the agent opens a pull request that drops the verification meta tag into the repository and then completes verification automatically. The cost accepted is that we must handle refresh-token rotation and re-consent, which the code does: the token is decrypted only in memory, only to trade it for a short-lived access token immediately before a query, and a failed refresh surfaces as "reconnect" rather than a crash.

### 1.6 Multi-tenancy: row-level security in Postgres, tenant_id on every table (ADR-0008)

One agency's audit of one client must never be visible to another tenant. There are two ways to enforce that, and the choice matters because getting it wrong is a breach, not a bug.

Application-level tenancy puts `WHERE tenant_id = ?` on every query. It fails open: ninety-nine queries carry the filter, the hundredth is written in a hurry, and the first symptom is one customer seeing another customer's data. Row-level security attaches the predicate to the table, so it applies to every query whether or not the author remembered it. It fails closed: an unscoped query returns zero rows, so a forgotten clause produces an empty page and a confused developer, a bug found in ten minutes rather than in a support ticket.

The decision is row-level security on every tenant-scoped table, with `tenant_id` on every table. This ADR is also the clearest example in the project of a decision that was got wrong, caught, and corrected, and the correction is worth recording because it is not obvious. There are three separate ways a Postgres role can skip row-level security:

1. RLS not enabled on the table. Closed by `ENABLE ROW LEVEL SECURITY`.
2. The role owns the table. Closed by `FORCE ROW LEVEL SECURITY`.
3. The role has the `BYPASSRLS` attribute. Closed by neither of the above.

Neon grants `BYPASSRLS` to its default role, which is the role in `DATABASE_URL`. The first implementation had `ENABLE` and `FORCE` set correctly on all five tables; the policies existed, appeared in `pg_policies`, and were never once consulted. An insert stamped with another tenant's id succeeded. The database looked secured and was not. The fix is a `NOLOGIN`, non-`BYPASSRLS` role, `seo_app`, that every transaction drops into with `SET LOCAL ROLE`, so the policies actually apply. The policy carries both a `USING` clause (which rows may be read) and a `WITH CHECK` clause (which rows may be written), because `USING` alone would let a tenant insert rows stamped with someone else's id. The tenant identity and the role are both transaction-local, so a pooled connection cannot carry one request's tenant into the next.

### 1.7 The API is the only door to the database (ADR-0009)

`apps/api` is named in the repo layout and drawn in the architecture map, but no story ever asked for it to be built, and the dashboard was one commit away from reading Postgres directly from React Server Components. That is a legitimate Next.js pattern in general and the wrong answer here, for four specific reasons: every Vercel serverless invocation opens its own connection pool against a free tier with a hard connection ceiling; the API is needed anyway for OAuth callbacks and webhooks and worker dispatch; reading from the web app would put the owner credential (which carries `BYPASSRLS`) into Vercel's environment as well as Render's; and the graded design document is generated from decisions that must be true of the deployed system.

The decision is that every read and write to Postgres goes through the API. `@seo/db` is a restricted import, allow-listed to the API, the worker, the audit runner, and the database package itself, and an ESLint rule fails the build if anything else imports it. The rule is enforced by CI, not by memory. Two consequences of the design are worth stating: authentication comes from a bearer token and never from a header a caller can set, because a header saying "I am tenant X" is a request to be tenant X, not proof of it; and a request for another tenant's resource returns 404, not 403, because a 403 confirms the row exists and lets an attacker enumerate which audits exist across the whole platform without reading a single byte of anyone's data.

### 1.8 Zero-cost infrastructure: Redis rejected, Supabase rejected, ceilings accepted (ADR-0006, ADR-0007)

A hard constraint on the project is that everything runs on a permanent free tier: total infrastructure cost is zero dollars. Three decisions do most of the work.

**Make the repository public.** The Quantic handbook encourages it, and public repositories get unlimited free GitHub Actions minutes. That single fact turns GitHub into a free worker fleet. A five-hundred-page Playwright crawl will not run on a free web service, but it runs beautifully in a GitHub Actions job that already has Chromium and no execution-time pressure at six hours per job.

**Drop Redis; use Postgres as the queue.** pg-boss provides a durable queue, scheduling, retries, and dead-letter handling on top of the Postgres already present. Redis was rejected for two reasons: it is a second service and a second free tier to babysit, and the free Redis tiers (Upstash caps at ten thousand commands per day) would have throttled a single large crawl anyway. This supersedes the mechanism in ADR-0004; the event-driven decision stands, only the queue technology changed.

**One Postgres, and nothing else.** Data (via Drizzle, with RLS by `tenant_id`), the job queue (pg-boss), the vector store (pgvector), and the compressed crawl artefacts all live in the same database, addressed only by `DATABASE_URL`. There is no vendor SDK anywhere in the repository, so the host is a commodity that swaps in an environment variable. Supabase was the original database choice and was rejected for two reasons recorded in ADR-0007: its free tier pauses a project after seven days of inactivity, and a paused database is a failed demo during a capstone that sits idle between sprints; and adopting Supabase meant taking on a platform (PostgREST, Realtime, Edge Functions, a service-role key) to use one commodity part of it, Postgres. Neon does not pause on idle and is plain Postgres.

The ceilings were accepted deliberately, not overlooked, and each has a documented migration trigger:

| Accepted ceiling | Migration trigger | Migration |
|---|---|---|
| Crawl artefacts as blobs in Postgres do not scale | ~300 MB of artefacts | Move blobs to Cloudflare R2; nothing else changes, the addressing is already indirect. |
| Neon free tier is ~0.5 GB | approaching the limit | Prune harder (keep only the latest crawl per site), then a paid Neon tier or self-hosted Postgres, still only `DATABASE_URL`. |
| Render free service cold-starts after fifteen minutes idle | the cold start hurts the product | An always-on paid instance, or ECS (see section 3). The dashboard already handles the cold start honestly rather than showing a broken page. |
| Refresh tokens in Google Testing mode expire after seven days | onboarding real clients | Submit the OAuth consent screen for Google verification. |

---

## 2. Software and architectural patterns

This section addresses rubric requirement 2: the software and architectural patterns used, and the reasons for using them.

### 2.1 Strategy / Adapter: `VersionControlProvider`, `@seo/llm` providers, `SerpProvider`

All VCS access sits behind a `VersionControlProvider` interface, with `GitHubProvider` as the first implementation. The fixer logic asks the interface to open a pull request; it does not know it is talking to GitHub. Adding GitLab or Bitbucket is a new adapter, and no call site changes. The same shape confines every model vendor behind a provider interface (see 2.2), and will confine SERP data behind a `SerpProvider` so SerpApi and DataForSEO are interchangeable. The reason is direct: the parts of this product most likely to change (which VCS host, which model vendor, which SERP index) are exactly the parts a Strategy pattern keeps out of the call sites.

### 2.2 Role-based indirection for the LLM layer, enforced by CI (ADR-0005)

Application code addresses models by **role**, never by vendor: `fast` for high-volume extraction, `smart` for reasoning and code generation, `embed` for page embeddings, and `judge` for grading the evaluation harness. Roles resolve at runtime from environment variables as ordered fallback chains, for example `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro`.

The reason is that everything about a model changes on a quarterly cycle: our OpenAI credit will run out, free tiers appear and vanish, model names change, prices change. If provider and model names are scattered through the code, every one of those events becomes a pull request and a regression risk. Under this design, each is an environment edit. Three properties make it work, and all three are unit tested: a target whose API key is absent is silently dropped from the chain, so a chain can list five providers and use only the ones with keys; a retriable failure (429, quota, 5xx) falls through to the next target; and `packages/llm/src/providers.ts` is the only file in the codebase allowed to import a vendor SDK.

That last property is not left to discipline. An ESLint rule lists the vendor SDK package names as restricted imports and allow-lists exactly one file, so importing `@ai-sdk/openai` anywhere else fails the build. This is the same mechanism that enforces "only the API touches the database" (1.7): the architecture is a property of CI, not of anyone's memory.

### 2.3 Chain of responsibility: the LLM fallback chain

The ordered fallback chain is a chain of responsibility. Each target in `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro,groq:llama-3.3-70b-versatile` gets the request in turn; a retriable failure passes it to the next; a success stops the chain. The reason is graceful degradation: running out of OpenAI credit mid-demo falls back to a free tier instead of failing, and the free tier degrades rather than breaking.

### 2.4 Repository pattern: `packages/db`

Drizzle ORM is confined to `packages/db`. Domain logic does not issue ORM calls directly; it goes through `withTenant` and `asOwner`, which own the transaction and the tenant scoping. The reason is that tenancy becomes enforceable in exactly one place: every tenant-scoped read and write passes through a function that sets the tenant and drops to the non-privileged role, so a handler cannot forget to scope a query, because it never touches the ORM directly. `asOwner` is the single, loudly documented exception for operations that logically precede a tenant, such as creating a tenant or resolving an API token.

### 2.5 The other patterns, briefly

| Pattern | Where | Reason |
|---|---|---|
| Pipeline / Chain | crawl, evaluate, prioritise, fix, verify | Each stage is independently testable and resumable. The audit runner is the one composition point where the stages meet; none of them knows about the others. |
| Registry | `packages/rules/src/registry.ts` | Rules self-register. Adding a rule touches one file, and `ruleCoverage()` is derived from the registry so it cannot drift. |
| Saga | AI visibility 3-day poll, CWV 28-day verification window | Long-horizon stateful workflows that outlive any process, modelled as scheduled jobs rather than long-running ones. |
| Guard | per-tenant budget guard before any paid call | Cost blowout is the primary operational risk in a product that makes paid API calls, so the guard runs before the call, not after. |
| Discriminated union | `Evidence` (`http`, `markup`, `metric`, `file`, `graph`, `search`) | A finding cannot record prose; it must hand back a typed observation a fixer can branch on and a verifier can re-observe. |
| Dependency injection | `enqueue`, the OAuth config, the `fetch` in every connector | The routes and the audit runner take their side effects as parameters, so a test drives them with a spy or a mocked endpoint without the network. |

---

## 3. Deployment options and cost implications

This section addresses rubric requirement 3: the deployment options, cloud or on-premises, with the relative cost implications of the choice. Figures are in USD per month and are realistic mid-range estimates for a small production workload (one always-on API, a worker fleet, one database of a few gigabytes, modest traffic).

### 3.1 Option A: the free tier (current deployment), $0/month

| Component | Service | Monthly cost |
|---|---|---|
| Web app | Vercel Hobby | $0 |
| API | Render free web service | $0 |
| Database, queue, vectors, artefacts | Neon free (~0.5 GB) | $0 |
| Worker fleet | GitHub Actions on a public repo (unlimited minutes) | $0 |
| CI | GitHub Actions (public repo) | $0 |
| **Total** | | **$0** |

This is what the project runs on today. The trade-offs are the accepted ceilings in section 1.8: a fifteen-minute cold start on the API, a ~0.5 GB database, and artefacts in Postgres. All are fine for a capstone, a demo, and an early-stage product with a handful of tenants, and each has a documented trigger and path off it.

### 3.2 Option B: managed cloud (AWS), roughly $105 to $160/month

The natural production target when the free-tier ceilings are hit. Indicative line items for a small footprint:

| Component | AWS service | Monthly cost |
|---|---|---|
| API (always-on) | ECS Fargate, 0.25 vCPU / 0.5 GB | ~$18 |
| Worker | ECS Fargate / Fargate Spot for crawl jobs | ~$25 |
| Database | RDS Postgres, db.t4g.micro, 20 GB, single-AZ | ~$20 |
| Queue cache (if Redis is reintroduced) | ElastiCache, cache.t4g.micro | ~$13 |
| Artefact storage | S3, tens of GB with lifecycle expiry | ~$3 |
| Load balancer | Application Load Balancer | ~$18 |
| Logs, metrics, data transfer | CloudWatch + egress | ~$10 |
| **Total** | | **~$107** |

Note that ElastiCache is optional. Because the queue is pg-boss on Postgres, a cloud deployment can keep the queue on RDS and drop the ~$13 Redis line entirely, which is one of the quiet benefits of the "no Redis" decision: it removes a cost line in every deployment tier, not just the free one. A high-availability setup (multi-AZ RDS, more workers) moves this into the $250 to $500 range.

### 3.3 Option C: on-premises

| Component | Cost basis | Monthly equivalent |
|---|---|---|
| Server hardware | one mid-range server, ~$2,500 capital, amortised over 3 years | ~$70 |
| Power and cooling | continuous operation | ~$25 |
| Bandwidth | business connection share | ~$30 |
| Hardware cash subtotal | | **~$125** |
| Operations labour | patching, backups, monitoring, security, on-call | **$300 to $800** |

The honest figure for on-premises is dominated by the last row, which the other two options largely absorb into their price. The free tier and managed cloud both include patching, backups, physical security, and hardware replacement; on-premises does not, and a small team pays for that in engineer hours whether or not it appears on an invoice.

### 3.4 Recommendation

For the current stage (capstone, demo, early access), **the free tier is the correct choice** and the total is genuinely zero. It is not a toy: the same code, the same database schema, and the same worker model scale up, because the only integration surface is `DATABASE_URL` and a set of environment variables.

When a ceiling in section 1.8 is reached, **migrate to managed cloud (Option B)**, one component at a time, following the documented triggers: artefacts to R2 or S3 first, then an always-on API, then a paid database tier. Because nothing in the code names a vendor SDK, each migration is configuration, not a rewrite.

**On-premises is recommended only under a specific constraint**, such as a data-residency or regulatory requirement that forbids a third-party host. Absent that constraint, its operations-labour cost makes it the most expensive option for a small SaaS, not the cheapest, and the intuition that "owning the hardware is cheaper" does not survive contact with the on-call rota.

---

## 4. Software testing carried out

This section addresses rubric requirement 4: all software testing carried out, including the automated tests, and the reasons for each. The suite is **400 automated tests**: 393 unit and integration tests plus 7 end-to-end tests, run on every push and pull request by CI.

### 4.1 Testing philosophy

Two principles shape the whole suite.

**Every finding carries its falsification condition, and the tests enforce it.** The domain model requires a non-empty `falsification` field on every finding, in three independent places: the TypeScript type will not compile without it, the Zod schema will not parse without it, and the database column is `NOT NULL`. A test constructs findings through the real engine and asserts the schema rejects an empty one, so "unfalsifiable advice" is not a guideline but a compile-and-runtime error.

**Where a claim can only be proven against real infrastructure, the test uses real infrastructure.** Row-level security is enforced by Postgres and by nothing else, so a mock would only test our beliefs about Postgres, and those beliefs were wrong once (section 1.6). The security tests, the queue tests, the API tests, and the end-to-end tests all run against a real Postgres. A mock there would be theatre.

### 4.2 The testing pyramid

| Layer | Count | What it covers | Why it exists |
|---|---|---|---|
| Unit | majority of 393 | The rule engine, the scorecard, the crawler's parsers and graph, the CrUX and quick-wins evaluators, the LLM chain resolution, the token crypto and OAuth state | Pure functions, fixture-driven, 100% deterministic, free to run. This is the bulk of the product's logic and involves zero external calls. |
| Integration | 6 files | The audit runner end to end, the queue against Postgres, tenant isolation against Postgres, the search step against Postgres with mocked Google | Prove the seams: the places where independently-tested packages meet, which no unit test can exercise. |
| Contract | 2 files | The CrUX API client and the Search Console client | Google's response shapes are theirs to change without warning. A contract test pins the shape so a change surfaces as a red test, not as an audit quietly reporting no data. |
| End-to-end | 7 tests | The real Next app against the real API against real Postgres, with RLS on | The dashboard's acceptance criteria are claims about a screen; only a browser can check them, and the claims that matter most (a blank axis stays blank, another tenant gets a 404) are exactly what a mock would lie about. |
| LLM evaluation harness | designed | Precision, recall, and hallucination rate of findings against a golden dataset | See 4.5. |

### 4.3 Per-package breakdown

| Package | Tests | Notable coverage |
|---|---|---|
| `@seo/crawler` | 152 | robots.txt matching (longest-match, tie-to-allow), sitemap parsing, the frontier and pacer, PageRank with dangling-mass redistribution, render comparison, and a live-browser integration test against a real HTTP server. |
| `@seo/rules` | 65 | Every one of the twenty deterministic `TECH-*` rules, the engine, and the coverage report. Includes the property that matters most: "finds nothing on a clean site." |
| `@seo/connectors` | 54 | CrUX thresholds at the exact boundaries, the Core Web Vitals evaluator, token encryption (round-trip and tamper detection), the OAuth state signing (forgery and replay), the CrUX and GSC contract tests, and the quick-wins evaluator. |
| `@seo/core` | 43 | The `Finding` schema and its falsification guarantee, the priority score, and the eight-axis scorecard including its refusal to score an unmeasured axis. |
| `@seo/api` | 35 | Authentication (no header, bad token, and the "never trust an asserted tenant id" case), tenant isolation across the HTTP boundary (404 not 403, indistinguishable from a genuinely missing row), the queue enqueue path, and the Google connection flow including forged-state rejection. |
| `@seo/audit` | 23 | The runner producing and persisting a complete audit, the reachability guard, the performance and search steps and their honest unmeasured states. |
| `@seo/db` | 10 | Tenant isolation, run against Postgres. Includes the assertion that would have caught the original bug: the query role has `rolbypassrls = false`. |
| `@seo/llm` | 6 | Chain resolution: absent keys dropped, fallback order preserved, a helpful error when no key is present. |
| `@seo/queue` | 5 | Enqueue and drain, and the concurrency guarantee that a job goes to only one of two racing drains. |
| `@seo/web` (e2e) | 7 | The dashboard, the findings inbox, the scorecard's honest blanks, and cross-tenant 404, all in a real browser. |

### 4.4 Tests that earned their keep by catching real defects

The suite is not decorative. Several tests failed on correct-looking code and prevented a real defect from shipping. These are documented because they are the strongest evidence that the tests are worth their cost:

- **The `BYPASSRLS` discovery (section 1.6).** The test that asserts the query role cannot bypass RLS is the test that revealed the entire tenant-isolation scheme was inert. It is now the first assertion in the security suite.
- **Confidently scoring a site never reached.** A test drove an audit of an unreachable host and found the runner produced a full scorecard from a single dead page, reporting "no sitemap" about a server that never answered. The runner now refuses to score a site it never saw.
- **The `onRequest` authentication leak.** A test showed that authenticating in Fastify's `preHandler` let an anonymous caller receive a 400 (revealing a route's schema) before the 401, because validation runs first. Authentication moved to `onRequest`.
- **An empty login shell.** A test caught the login page rendering as blank HTML because `useSearchParams` had silently opted the route out of server rendering.
- **A build-time environment variable read at runtime.** The end-to-end suite caught `NEXT_PUBLIC_API_URL` being inlined at build time, so a deployed app would dial whatever URL it was compiled with.

### 4.5 The LLM evaluation harness

The deterministic rule engine (section 1.1) is what makes most of the product testable by ordinary means, because a parser is a pure function. The probabilistic half, where the model writes a fix, needs a different instrument, and its design is fixed even though the fix-generation it measures lands in a later sprint.

The harness is a golden dataset of roughly fifty pages with known, hand-labelled ground-truth issues. Against it, the harness measures three numbers: **precision** (of the findings raised, how many are real), **recall** (of the real issues, how many were found), and **hallucination rate** (findings that reference code or elements that do not exist). In production it adds two more: pull-request merge rate and pull-request revert rate, the ultimate ground truth for whether a fix was correct.

One methodological decision is already enforced in code and tested: the `judge` role that grades the harness **must be a different model family than the model under test**. Grading OpenAI's output with OpenAI produces self-preference bias and an evaluation that flatters itself. The role-based LLM layer (section 2.2) makes this a one-line configuration (`LLM_JUDGE=google:gemini-2.5-pro` while the fixer runs on OpenAI), and the chain-resolution tests already prove the layer routes each role independently. What remains for a later sprint is the golden dataset itself and the harness runner, which are meaningful only once the model is generating fixes to grade.

### 4.6 Continuous integration

Every push and every pull request runs the full gate: format check, lint, typecheck, build, database migration, the 393 unit and integration tests, and the 7 end-to-end tests. CI provisions a real Postgres 18 service container for the tests that need one, deliberately a different Postgres from Neon, because the container's default role is a superuser and superusers also bypass RLS, so if the `seo_app` role drop were broken the isolation tests would fail in CI rather than in production. Three code-level laws are enforced mechanically by the same pipeline: no vendor SDK outside `providers.ts`, no `@seo/db` import outside the API and worker, and no finding without a falsification condition. The architecture is not a document the code is asked to honour; it is a set of checks the code must pass.

---

## Appendix: Architecture Decision Record index

| ADR | Decision | Status |
|---|---|---|
| 0001 | Deterministic detection first, LLM second | Accepted |
| 0002 | GitHub App over personal access token | Accepted |
| 0003 | OAuth per tenant over service account for Search Console | Accepted |
| 0004 | Event-driven job queue over synchronous request-response | Accepted; mechanism superseded by 0006 |
| 0005 | Provider-agnostic LLM layer addressed by role | Accepted |
| 0006 | Zero-cost infrastructure: pg-boss on Postgres, GitHub Actions workers | Accepted |
| 0007 | Plain Postgres on Neon over Supabase | Accepted; supersedes the Supabase parts of 0006 |
| 0008 | Tenant isolation in Postgres via a non-BYPASSRLS role | Accepted |
| 0009 | The API is the only door to the database | Accepted |
| 0010 | The performance axis is CrUX field data, never Lighthouse | Accepted |

The ADRs are the primary source; this document summarises them and adds the deployment-cost and testing analysis the rubric requires. Where the two differ, the ADRs win, because they are never edited after acceptance and this document is regenerated.
