# Design and Testing Document

**Project:** Rankwright, an autonomous SEO agent
**Programme:** Quantic School of Business and Technology, MSSE Capstone
**Scope of this document:** the design and architecture decisions, the software and architectural patterns used, the deployment options with their cost implications, and the testing carried out. It is generated from the thirty-seven Architecture Decision Records in `docs/adr/`, the architecture map in `docs/architecture.md`, the CI configuration, and every test in the repository. It reflects the system through Sprint 3, in which the four dark axes were lit: AI visibility is measured by polling answer engines over days, authority leads with brand mentions, and agent readiness and local are read from the crawl. Sprint 3 also introduced the product's first paid dependency and the cost guard that contains it. It was last brought up to date on 5 October 2026, after the work that followed hands-on use of the deployed product: findings that keep their identity from one audit to the next, hosting credentials that belong to a site and not to the operator, a rule engine grown from thirty-one checks to forty-four, a crawl that checks outbound links, phone-width layout and image weight, and a golden evaluation dataset of fifty real pages. Sections 1.16 to 1.18, 4.2 to 4.5 and the ADR index carry those changes. It was brought up to date again on 7 October 2026 for the work of that week: an agent that reads the repository and proposes the fix, hosting connected by consent, a weekly competitor watch, the first findings raised from the topic map, an interface rebuilt on a new structure, and a second seeded tenant that makes populated screens something a person can look at. Sections 1.16a, 1.19, 1.20 and 4.4a carry those, and every count in section 4 was re-taken from a full run of the suite on that date.

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
- **Testability.** A pure function reaches 100% unit coverage against fixtures. The rule engine is 180 tests over deterministic inputs, and that is the majority of the product's logic.
- **Cost.** Most of an audit costs nothing but compute. The model is invoked once per *fixable finding*, not once per page. A five-hundred-page crawl with fourteen fixable findings is fourteen model calls, not five hundred.
- **Honesty.** Hallucinated findings, the ones that reference code that does not exist, become structurally impossible for the core checks, because a parser cannot invent a status code it did not see.

Sprint 3 tested this line in the place it was most tempting to cross. The AI-visibility axis measures what answer engines say, and the obvious implementation is to ask a model "is this site cited for this query". That is a model grading its own output family, and the decision (ADR-0015) is that the engine is the thing being *measured*, never the judge. A parser decides citation by matching domains in the engine's own source list. The same line held on the authority axis, where mention classification is domain arithmetic, and on the consensus range, which is a regular expression over currency amounts rather than a model summarising a model.

This line is drawn on the architecture map and defended everywhere: detection is deterministic, reproducible, and free; fixing is probabilistic and always reviewed by a human. Detection never crosses that line.

### 1.2 The technology stack, and why each part was chosen

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | One install, shared types across every package, CI runs once, task caching. |
| Language | TypeScript, strict, NodeNext | One language across web, API, worker, and rules. The `Finding` type is defined once and every package agrees on it. Zod schemas give the same types at runtime that the compiler gives at build time. |
| Web app | Next.js 15 App Router, Tailwind | Server components keep the API token in an httpOnly cookie, off the browser. Deploys free to Vercel. |
| API | Fastify + Zod | Small, fast, and Zod validates every request at the boundary before a query runs. |
| Database | Plain Postgres on Neon | One commodity database, addressed only by `DATABASE_URL`. See 1.8. |
| Queue | pg-boss on the same Postgres | Durable jobs without a second piece of infrastructure. See 1.3 and 1.8. |
| Worker | GitHub Actions on a public repo | Unlimited free minutes, Chromium preinstalled, no execution-time pressure. See 1.3 and 1.8. |
| Crawler | Playwright, Chromium | Renders JavaScript, which is what Google indexes. A raw-HTML fetch would miss client-rendered content. |
| LLM | Role-based, provider-agnostic layer | Swapping a model is an environment edit, never a code change. See 2.2. |
| SERP and AI-Overview data | `SerpProvider` interface, SerpApi adapter | The only paid dependency. Behind a Strategy seam and a hard budget cap. See 1.12. |
| Cost control | `@seo/budget`, a per-tenant cap and ledger | Checked before every paid call, LLM and SERP alike. See 1.13. |
| VCS integration | GitHub App via Octokit | Least privilege, short-lived tokens, auditable. See 1.4. |

### 1.3 Event-driven job queue over synchronous request-response (ADR-0004, ADR-0006)

A full audit crawls up to five hundred pages with a headless browser, calls PageSpeed Insights per template page, pulls Search Console data across several dimensions with pagination, polls several AI engines once a day for several days, and generates code fixes. This takes minutes to days, not milliseconds, and it cannot live inside an HTTP request. External APIs rate-limit us, fail transiently, and impose hard daily quotas (Search Console URL Inspection is capped at two thousand per day per property).

The decision is an event-driven architecture with a durable job queue. The API enqueues, the worker processes, the web app polls the audit row for progress. Jobs are idempotent and resumable, and every job carries a tenant id.

Concretely, and this is the shape verified end to end in the tests: the API creates the audit row as `queued`, puts a job on pg-boss, and fires a `repository_dispatch` to GitHub. A GitHub Actions runner spins up, claims the job, runs the crawl and the rules and the scorecard, and writes the result back. A fifteen-minute schedule drains the queue as a safety net, so a job is never stranded even if the dispatch is missed. The `repository_dispatch` is a nudge to start sooner, never the delivery mechanism: the job is already durable in Postgres, so a failed or absent dispatch means the audit starts a little later, never that it is lost. Retries are bounded and a claimed job is invisible to a second worker, so the schedule and a dispatch firing together cannot run an audit twice.

Sprint 3 added a fifth queue, `poll-ai`, and with it a scheduling pattern worth naming. There is no cron entry per site. The worker, on each of its fifteen-minute wakes, asks the database "which sites have prompts and no poll recorded for today" and enqueues those. That query is both the schedule and its own catch-up: a runner that never started, a job that exhausted its retries, or a day the whole worker was down all resolve themselves on the next wake, with no cron state to drift and nothing to reconcile by hand.

The same shape was reused for work that has no queue at all. The competitor watch (1.19) is a sweep: on each wake the worker asks which tracked competitors have no snapshot newer than seven days and reads a few of them. The measured behaviour of the schedule is the reason. The cron is declared every fifteen minutes and GitHub throttles it to a median nearer three hours, so anything that must happen on a particular day sometimes will not, while "is anything overdue" is a question that survives any schedule.

The rejected alternative was synchronous HTTP: a five-hundred-page Playwright crawl will never complete inside a request timeout. Serverless fan-out was deferred: cold starts and execution-time limits are hostile to Playwright.

### 1.4 GitHub App over personal access token (ADR-0002)

The agent needs write access to a client's repository to open pull requests. Two ways to get it: a personal access token the client generates, or a GitHub App the client installs.

The decision is a GitHub App, requesting the minimum permissions: `contents: write`, `pull_requests: write`, `metadata: read`, `checks: read`, using short-lived per-repository installation tokens. The reasoning is least privilege and auditability. A personal access token is long-lived, usually over-scoped, tied to a human rather than to the integration, and invisible in the organisation's audit log. No security-conscious client would grant one. A GitHub App installation appears in the organisation's audit log, so a client sees exactly what we can touch and revokes it in one click. An OAuth App was rejected because it acts as the user and inherits all of the user's repository access, far broader than we need. Deploy keys were rejected because they cannot open pull requests. All of it sits behind a `VersionControlProvider` interface (see 2.1) so GitLab and Bitbucket can be added without touching the fixer logic.

Deployment verification additionally requires `deployments: read`, approved by installation owners. [ADR-0027](adr/0027-read-deployment-evidence.md) extends the original permission set; the separate reporting pipeline, not the Rankwright App, needs deployment write access.

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

The scheme has since grown from five tables to fifteen without amendment, which is the property a good tenancy model should have. Each new table (the visibility prompts and checks, the spend ledger, fix attempts, hosting connections, and most recently the competitor snapshots and changes of 1.19) arrived with `tenant_id`, a policy, and a grant. One integration test reads the catalogue and fails on any table in the schema without forced row-level security, so a table added without a policy is a red build rather than a review comment.

### 1.7 The API is the only door to the database (ADR-0009)

`apps/api` is named in the repo layout and drawn in the architecture map, but no story ever asked for it to be built, and the dashboard was one commit away from reading Postgres directly from React Server Components. That is a legitimate Next.js pattern in general and the wrong answer here, for four specific reasons: every Vercel serverless invocation opens its own connection pool against a free tier with a hard connection ceiling; the API is needed anyway for OAuth callbacks and webhooks and worker dispatch; reading from the web app would put the owner credential (which carries `BYPASSRLS`) into Vercel's environment as well as Render's; and the graded design document is generated from decisions that must be true of the deployed system.

The decision is that every read and write to Postgres goes through the API. `@seo/db` is a restricted import, allow-listed to the API, the worker, the audit runner, the budget package, and the database package itself, and an ESLint rule fails the build if anything else imports it. The rule is enforced by CI, not by memory, and the allow-list is deliberately expensive to extend: its comment reads "adding to this list is an ADR, not a fix", and when the cost guard needed a database handle in Sprint 3 that requirement was honoured rather than waived, which is what ADR-0017 exists to record.

Two consequences of the design are worth stating: authentication comes from a bearer token and never from a header a caller can set, because a header saying "I am tenant X" is a request to be tenant X, not proof of it; and a request for another tenant's resource returns 404, not 403, because a 403 confirms the row exists and lets an attacker enumerate which audits exist across the whole platform without reading a single byte of anyone's data.

### 1.8 Zero-cost infrastructure: Redis rejected, Supabase rejected, ceilings accepted (ADR-0006, ADR-0007)

A hard constraint on the project is that infrastructure runs on a permanent free tier: total infrastructure cost is zero dollars. Three decisions do most of the work.

**Make the repository public.** The Quantic handbook encourages it, and public repositories get unlimited free GitHub Actions minutes. That single fact turns GitHub into a free worker fleet. A five-hundred-page Playwright crawl will not run on a free web service, but it runs beautifully in a GitHub Actions job that already has Chromium and no execution-time pressure at six hours per job.

**Drop Redis; use Postgres as the queue.** pg-boss provides a durable queue, scheduling, retries, and dead-letter handling on top of the Postgres already present. Redis was rejected for two reasons: it is a second service and a second free tier to babysit, and the free Redis tiers (Upstash caps at ten thousand commands per day) would have throttled a single large crawl anyway. This supersedes the mechanism in ADR-0004; the event-driven decision stands, only the queue technology changed.

**One Postgres, and nothing else.** Data (via Drizzle, with RLS by `tenant_id`), the job queue (pg-boss), the vector store (pgvector), and the compressed crawl artefacts all live in the same database, addressed only by `DATABASE_URL`. There is no vendor SDK anywhere in the repository, so the host is a commodity that swaps in an environment variable. Supabase was the original database choice and was rejected for two reasons recorded in ADR-0007: its free tier pauses a project after seven days of inactivity, and a paused database is a failed demo during a capstone that sits idle between sprints; and adopting Supabase meant taking on a platform (PostgREST, Realtime, Edge Functions, a service-role key) to use one commodity part of it, Postgres. Neon does not pause on idle and is plain Postgres.

**The asterisk, added honestly in Sprint 3.** The infrastructure is still zero. The *data* is not, for two of the eight axes. AI Overviews and brand mentions come from a SERP vendor that charges per query and has no free tier usable at product scale, and scraping them ourselves was rejected as a false economy (see 1.12). So the claim is now precise rather than absolute: infrastructure is $0 for every tenant; six of the eight axes are $0 for every tenant; and the two earned-media axes cost money to measure at all, are off by default, and are capped per tenant when switched on. Saying so is better than quietly dropping the claim or quietly dropping the axes.

The ceilings were accepted deliberately, not overlooked, and each has a documented migration trigger:

| Accepted ceiling | Migration trigger | Migration |
|---|---|---|
| Crawl artefacts as blobs in Postgres do not scale | ~300 MB of artefacts | Move blobs to Cloudflare R2; nothing else changes, the addressing is already indirect. |
| Neon free tier is ~0.5 GB | approaching the limit | Prune harder (keep only the latest crawl per site), then a paid Neon tier or self-hosted Postgres, still only `DATABASE_URL`. |
| Render free service cold-starts after fifteen minutes idle | the cold start hurts the product | An always-on paid instance, or ECS (see section 3). The dashboard already handles the cold start honestly rather than showing a broken page. |
| Refresh tokens in Google Testing mode expire after seven days | onboarding real clients | Submit the OAuth consent screen for Google verification. |
| ~~No backlink index, so referring domains are unmeasured~~ **Trigger pulled (ADR-0021).** A `BacklinkProvider` seam with a DataForSEO adapter now measures referring domains when credentials are configured, and reports them unmeasured when they are not. Mentions still lead the axis. | n/a | n/a |
| Rank tracking is not built, so positions over time are unmeasured | a client who needs daily position data | A `tracked_keywords` table, a `rank_checks` table and a daily poll saga. Deliberately deferred: it is the one workflow with a per-keyword-per-day cost that never stops, so it breaks the zero-cost-by-default posture in a way the per-audit paid calls do not (ADR-0021). |

### 1.9 The write path is deterministic too, and the LLM is on a short leash (ADR-0011)

ADR-0001 drew the detection line; opening pull requests reopened the same temptation in a more dangerous form. Hallucinating a finding produces a bad row in a dashboard; hallucinating a change produces a bad commit against a client's `main`. "Ask the model to rewrite this file so the canonical is correct" can reformat the whole file, drop unrelated content, or invent a framework convention, and the reviewer is then diffing the model against the world rather than reading a small, obvious change.

So the decision extends deterministic-first to the write side. A fixer (`packages/fixers`) is a pure function of the finding and the repository, and it transforms structure it has located rather than guessing. The canonical fixer rewrites an origin only at a URL boundary, so `https://site.com` never corrupts `https://site.com.evil.test`. The robots fixer walks the file's groups and changes the one line that blocks an AI search crawler, keeping every other byte. The noindex fixer strips the indexing directive from a head meta and leaves the rest. Sprint 3 added two more in the same shape: an `llms.txt` writer that generates the file from pages the crawl already found, and a `LocalBusiness` schema block populated from the site's own contact details. When a fixer cannot locate what it would change, it returns null and the worker reports honestly that no fix could be generated, rather than opening a pull request that changes nothing or the wrong thing. Each fixer ships with a triggering fixture and a clean one.

The one place a model writes to a repository, the meta-description fixer, is held to the same shape and this is the whole reason the deterministic line matters on the write side. A deterministic rule (TECH-021) finds the missing description; the fixer makes **exactly one** `smart` call through `llm.object` with a Zod schema; the output is schema-validated before it can become a diff; and a deterministic head injection places it. The model writes text, a parser writes files. If the model chain is unconfigured or every target fails, the call throws, the fixer returns null, and the finding stays open. A broken pull request is worse than no pull request. This satisfies the cost discipline in ADR-0005 directly: one model call per fixable finding, never one per page.

### 1.10 Pull-request safety and webhook security (ADR-0012, ADR-0014)

The promise to open pull requests is only safe to make if a set of guarantees hold every time, without relying on anyone remembering them. Two ADRs make them structural.

**Nothing is ever pushed to the default branch, because the interface cannot express it (ADR-0012).** The `VersionControlProvider` has no method that writes to a caller-named branch and none that pushes to the default branch; it can read a file, create a fresh branch, write onto a branch it just created, and open a pull request. CLAUDE.md rule 2 ("never push to `main`") is therefore not a convention a fixer must recall but a shape it cannot violate, because the method does not exist. The pull-request body is built before any branch or commit, and the builder refuses to render without all five required sections (the finding, the evidence, the expected effect, the falsification condition, and a rollback note), so a fix missing any of them fails closed with no state left behind. The write path is idempotent: before cutting a branch it asks GitHub whether a pull request for this finding is already open, matched by the branch prefix, and returns the existing one rather than a second. The fixer engine also enforces the programmatic-page cap, refusing above fifty files and warning above thirty, so a runaway fix is stopped at the engine, not at the pull request.

**A merged pull request drives the loop, and the webhook that reports it is verified before it is read (ADR-0014).** `POST /webhooks/github` is necessarily public: GitHub calls it with no bearer token. Every delivery is signed with an HMAC over the exact body bytes under our webhook secret, and the handler verifies that signature first, returning 401 without touching the payload if it fails. Because GitHub signs the raw bytes, the route preserves the raw request body (re-serialising a parsed object would not reproduce them and the signature would never match). Repository access tokens are minted on demand from the App's private key, cached only to the edge of expiry, and never stored, so a database dump yields no repository credential. The App private key lives only in the secret stores, never in the public repository. Because a webhook carries no tenant, it resolves the affected rows itself under `asOwner`, matching a merged verification pull request by branch name and a merged fix pull request by the pull-request URL stored when it was opened; the verified HMAC is what makes trusting those fields safe.

Together these close the loop end to end: a fix pull request opens, a human merges, the webhook marks the finding merged and enqueues a re-audit, and the verifier re-runs the finding's own rule over a fresh crawl and marks it verified if it is gone or rejected if it still fires. The rejected outcome is the product's thesis made mechanical: we shipped, we measured, and a parser (not a promise) says whether it worked.

### 1.11 AI-visibility citation is measured over days, not asked (ADR-0015)

AI visibility is the axis the product is named for and the one most easily faked, and the fakery is the industry norm in two specific ways.

The first is letting a model decide its own citation. Asking a model "is this site cited for this query" is an LLM grading itself, non-reproducible and unfalsifiable. The decision is that a **deterministic parser** decides citation by matching the client's domain against the engine's own cited sources, normalising hosts and rejecting look-alikes so `example.com.evil.test` is never `example.com`. Where an engine returns no source list (a plain chat model answers from weights), the parser falls back to the domain appearing in the answer text and records that the basis was a weaker `mention` rather than a citation. Google's AI Overview, reached through the SERP provider, is the one engine that returns real sources, which is why its verdicts are the strongest evidence the axis has.

The second is reporting a citation from a single poll. In a controlled study, roughly 45% of citations appeared in only one of three checks, so a tool that polls once and reports "you are cited" is reporting noise as fact about half the time. The decision is that a citation is reported only when it holds across **at least three polls over at least three distinct days**, and the honesty bar is enforced structurally rather than procedurally, in three places:

- The summarising function takes the distinct-day count as a **required argument**. Three engines polled within one minute satisfy a sample-size floor while measuring a single moment, and making the day count un-skippable at the type level means the bar cannot be cleared by forgetting an optional parameter.
- A **unique index** on (prompt, engine, day) makes a retried job a no-op instead of a duplicate, so a sample can only grow by a day passing, however many times the queue re-runs.
- The **day travels in the job payload** rather than being read from the clock inside the job, so a job enqueued at 23:58 and retried at 00:03 still writes the correct day's row.

The result is an axis that refuses to answer for three days and then answers with a sample anyone can audit. Findings distinguish the two different meanings of "not cited": a rival cited where the client is not is a high-severity competitive loss with a named opponent, and nobody cited at all is a low-severity open field whose falsification says plainly that the honest outcome may be to stop spending on that question.

### 1.12 Paid data behind a provider, under a hard budget cap (ADR-0016)

Two axes need data no crawl can produce. AI visibility needs Google's AI Overview and its cited sources; authority needs brand mentions across the web. Both are sold per query, and this is the first genuinely paid dependency in a product whose constraint is zero cost.

The decision is a Strategy seam plus a cap. A `SerpProvider` interface fronts the vendor, with a SerpApi adapter behind it, so the measurement code is vendor-blind and swapping to DataForSEO is an adapter and an environment variable. Nothing above the adapter knows a vendor exists, and the deterministic parsers are tested against fakes with no key and no spend.

Two implementation choices inside that seam are worth recording because both trade a little capability for a lot of predictability. An AI Overview that the vendor defers behind a continuation token is **not** followed: that is a second billable query for the same measurement, and doubling the cost of the most expensive axis is not a decision a parser should make unasked, so the day records as "no overview", which is honest and free. And an absent overview is recorded as an uncited observation rather than dropped, because plenty of queries genuinely have no overview and a hole in a three-day window is expensive.

Scraping the data ourselves was rejected as a false economy. It looks free and is not: Google actively blocks scraping of AI Overviews, so it needs rotating proxies and headless browsers at scale, which is infrastructure we would pay for and babysit, on top of a terms-of-service position no client wants their brand associated with.

### 1.13 The cost guard runs before the spend, not after (ADR-0017)

ADR-0016 relied on a per-tenant budget guard that did not exist. The LLM layer had taken a budget checker as a constructor argument since ADR-0005, which is the right seam, but the worker filled it with a function that returned "allowed" every time. For most of the project that was a defensible deferral: the only paid calls were one `smart` call per fixable finding, triggered by a human clicking a button, and a human clicking a button is itself a rate limit.

The AI-visibility poll ended that. It spends **every day, per prompt, per site, indefinitely, with nobody present**. A tenant with twenty prompts and a paid chain makes six hundred calls a month without anybody deciding to, and the gap between an ADR that said "capped" and code that said "allowed" stopped being a deferral and became a false statement about the system.

The guard now checks a per-tenant monthly cap **before** the call and can refuse it. Three properties are load-bearing:

- **Before, not reconciled after.** A guard that notices afterwards is a report: it can tell you what you spent, it cannot stop you spending it. The worst case for a misconfigured tenant is a dark axis, never a bill.
- **Keyed on the tenant.** A platform-wide limit is not a cap for anybody, because the first tenant to run away spends everyone else's allowance and the tenants who then get refused are the ones who did nothing wrong.
- **Fails closed.** If the ledger cannot be read, the call is refused. A guard that allows the call when the database is unhappy is a guard-shaped hole that opens at exactly the wrong moment. The cost of being wrong that way is money; the cost of being wrong the other way is a job that retries.

Spend is recorded as a **ledger, not a counter**: every paid call writes a row carrying kind, provider, model, cost, tokens, and time. A running total answers "how much" and nothing else, and the first real incident is always "why did this cost forty dollars last month". The ledger also makes the cap auditable, since the guard's verdict is a sum anyone can re-run by hand. LLM and SERP calls share one cap, because two budgets would let a tenant spend twice what either allows. Money is stored in micro-dollars, because thousands of fraction-of-a-cent calls have to sum without drift and an integer gets that by construction where a float gets it by luck.

Two limitations are recorded rather than hidden. The cap is a **threshold, not a reservation**, so a tenant can overshoot by at most one call, since a call's cost is not known until it returns. And an **unpriced model is invisible to the cap**: the pricing table is maintained by hand, and a model missing from it records zero while billing real money. That cannot be closed from inside the guard, so it is made loud, with a warning naming the model, and a test asserts the warning fires on tokens-without-price while staying silent for a genuinely free call.

### 1.14 The authority axis leads with mentions, not links (ADR-0018)

Every SEO tool opens its off-page section with backlinks, and it is the number clients ask for by name. The evidence for what moves AI visibility does not support that ordering: branded web **mentions** correlate **0.664** with AI Overview visibility, backlinks correlate **0.218**, and 84% of AI citations come from earned media. Mention-building and link-building are two different jobs, and an axis that opens with referring domains sends a client to do the one that matters less.

So the axis measures mentions and reports referring domains as **unmeasured**, never as zero, because a zero and an absence look identical on a dashboard and mean opposite things. Four implementation decisions carry the honesty:

- **Counted by distinct domain, never by result.** Ten pages on one publication is one publication that covered the client; counting results would let a single press release read as a campaign.
- **The query does the separating.** The brand is quoted (so "Heartbeest Safaris" does not match any page containing "safaris") and the client's own site is excluded with a search operator, which makes the result earned media by construction rather than something filtered afterwards and hoped for.
- **Earned coverage is kept apart from self-published platforms.** Not because social is lesser but because it is different evidence: a company's own post is a mention it wrote, a trade publication's article is one it earned, and merging them would let a busy social calendar read as authority.
- **The brand name is stored, not derived.** A domain yields a stem the web has never heard of, because the press writes the spaced name. Guessing the spaces back in would under-count every multi-word brand, and an under-count here is indistinguishable from a brand nobody talks about.

Outreach is drafted and **never sent** (CLAUDE.md rule 6). There is deliberately no transport in the module: no address book, no queue, nothing to call. It returns text, and everything that turns that text into an email is a human's deliberate act under their own name. Automating the send sounds like a small step from drafting and is not, because the moment it is automated the review becomes a formality and the failure mode is a client's name on a hundred emails they never read. The drafter also **refuses** when it has no concrete, sourced fact to build on, returning nothing and making no model call at all, because a pitch with no specific fact is the template every other tool sends and spending a client's name on one costs them a relationship for no gain.

### 1.15 `llms.txt` is agent-readiness infrastructure, and never a ranking claim (ADR-0019)

`llms.txt` is the most oversold file in the industry, marketed as an AI-SEO essential and sold as a deliverable. Google's own guidance lists it among the tactics to ignore: Search does not use it, and because AI Overviews run on the same core ranking systems, a file Search ignores does not influence them either.

We ship an `llms.txt` rule and fixer, which puts us one careless sentence away from selling the same lie. The decision is that no text we generate may claim or imply a ranking benefit, and that this is enforced by tests rather than by review attention: one test asserts the disclaimer lives in the finding itself so the UI cannot drop it, and another asserts it in the generated file. A rule enforced by attention fails silently the first time attention lapses, and the failure mode is a sentence in a pull-request body that a client reads and believes.

Writing this ADR caught a real inconsistency, which is recorded because the reasoning generalises. The scorecard's own comment cited this finding as the example of why the `info` severity scores zero, on the grounds that a finding admitting it changes nothing must not change a score. That argument is right about *search* and wrong here: the finding sits on the `agent_readiness` axis, missing `llms.txt` is a genuine if small gap in whether agents can navigate the site, and scoring it zero would leave the axis unable to tell a site that has the file from one that does not, on the one property it exists to measure. The rule was correct at `low` severity; the comment explaining it was not. Being honest about what a fix will not do is not the same as pretending the gap is absent.

### 1.16 A finding is the same finding on the next audit (ADR-0029)

Every audit writes its own finding rows and the inbox shows the newest audit. A finding's key (`TECH-004#3`) is its position in one audit's output, which moves whenever a page is added, so each audit's findings were strangers to the last one's. That had a visible cost. A finding with a pull request open left the inbox on the next audit, and the same issue returned as an untouched, fixable finding whose button opened a second pull request for work already in flight. A "won't fix" decision was forgotten on every run, and nothing could say how long an issue had been open.

The decision is a deterministic fingerprint, `sha256(ruleId | subject)`, where the subject is the first affected URL unless the rule names one (a duplicate title is about the title, whichever pages share it this week). When an audit is written, each finding is matched to the newest earlier finding with the same fingerprint on the same site, and two things are carried forward: when the issue was first seen, and a won't-fix status, which is a person's answer about the issue rather than about one audit's copy of it.

**A pull request and its outcome are deliberately not copied.** They stay on the row the pull request was opened for, because the webhook, the reconciler and the verifier all find that row by its URL, and a second row holding the same URL would give those paths two candidates. The newer finding is linked to the earlier one when it is read: a fix that is open or merged withholds the button and the API answers 409, a verified fix that has returned is shown as back after a fix, and a rejected one offers the fix again. The refusal is enforced in the API and not only by hiding a button, because the MCP server calls the same route. The alternative, a separate `issues` table that findings point at, is the cleaner model and was rejected as a rewrite of every query in the product for a benefit the fingerprint column already delivers.

### 1.16a The agent reads the repository and proposes the fix (ADR-0030)

Section 1.9 describes a write path in which a model writes one string and a parser writes the file. That held the line on safety and it capped the product: by October a pull request was possible for 11 of 44 rules, and an audit of a real site showed a Fix button on a handful of findings and "Needs you" on the rest. For a product whose positioning is a pull request instead of a list, that label was the list.

The cause is that a hand-written fixer must know in advance where each framework keeps each thing, and a missing H1 lives somewhere different in every repository. So a second kind of fixer was added and placed last: the registry first, then the meta-description writer, then an agent that reads the repository. Detection does not move. The agent is handed a finding a deterministic rule already produced and asked for the change that makes that rule pass.

What makes this defensible is that everything around the model call is code. A selector scores the repository's file tree against the finding, reads the best candidates, promotes those containing the finding's own evidence, and stops at 14 files and 70,000 characters. Environment files, workflows, lockfiles, keys, migrations and tests are refused by path before their content is fetched, and a file that contains something shaped like a credential is withheld; one of the two real repositories used in development has an environment file committed, so this is not hypothetical. The model returns a Zod-validated object of find-and-replace edits, never whole files, so a change reads as a diff. Before any pull request exists the proposal is applied in memory and thrown away if it edits a file the model was not shown, if a search string does not match exactly once, if it exceeds 8 files or 30 edits, if it deletes more than half a file, or if it introduces a hostname that is neither the site's nor already present. Declining is a first-class answer and its reason is shown on the finding.

Fourteen rules are on the agent's list and three near neighbours are deliberately off it, because their fix is a choice (which of robots and the sitemap is right, where a redirect should go) or needs something the agent cannot see (what an image shows). The findings that remain manual no longer say "Needs you". Each names one of four reasons, because each implies a different next step for the reader. The cost stays inside ADR-0005: one `smart` call per finding, and a second only when the model asks for more files.

The first test of that design against reality needed no model (ADR-0031). Because selection is deterministic, it was run against the repositories of the two real sites, and what it chose was read by a person. It found that the prompt was more than twice what the configured free-plan models accept in a minute, that a refusal for size would not have fallen through the model chain, that the error shown would have been a header with no cause, and four ranking mistakes a hand-made file tree had not shown. The context now has three sizes and steps down on a size refusal, and each ranking mistake has a test named for what went wrong. The method is the lesson: a deterministic stage can be rehearsed against production inputs for free, and the rehearsal found more than the unit tests did.

The limit is stated plainly in the ADR and here: the deterministic half is tested exhaustively and the whole path is tested against a real database with a fake model, but no test calls a real model. The measures of the model half are the merge rate and revert rate of its pull requests in production.

### 1.17 Proof of deployment, and whose credentials provide it (ADR-0027, ADR-0028)

A merged fix is marked verified only when there is evidence that the site's domain is serving a commit that contains it. Re-crawling too early would "verify" a fix against the previous deployment, or reject one that had not shipped yet. The evidence is read, not inferred: GitHub deployment records through the App's `deployments: read` permission (ADR-0027), and for a Vercel custom domain, where GitHub's status names a generated URL rather than the domain, the domain's current alias assignment from the hosting API.

That second path first worked through one hosting token in the worker's environment. It passed live acceptance on the operator's own site and could not have worked for anyone else: an operator token sees only the operator's projects. Widening it would have made one credential the key to every customer's hosting account. The decision (ADR-0028) is that a hosting connection belongs to a site. The customer supplies a token and a project for one site; the API validates before storing, against the site URL and repository on its own record; the token is stored as ciphertext of `{ tenantId, siteId, token }`, so a row copied to another site decrypts to a binding that does not match; the API never returns it; and the worker loads only the connection of the site it is verifying, with no environment fallback. A verification re-reads the site and the connection's revision under a row lock before saving, so a connection replaced or removed during the re-crawl cannot produce a verified result. Sites on other hosts report deployments from their own pipeline through GitHub and store no credential at all.

A pasted token rather than OAuth is a deliberate, recorded compromise. CLAUDE.md rule 5 forbids asking for a Google password; this is a revocable API token for a hosting provider. The OAuth equivalent is a marketplace integration with a review and an always-reachable callback, on an API instance that sleeps (ADR-0006). The token form is the smallest thing that removes the shared credential, and the integration can replace it later without changing the table or the worker.

### 1.18 The crawl asks three more questions, after the site and under the same guard

The crawler renders each page once at desktop width, stays on the site's own host, and blocks images. Three things an audit plainly needs were therefore never measured, and all three are now measured **after** the page crawl, so they cannot slow or starve it, and **through the same egress guard, hop by hop**, so a page cannot use them to make the crawler reach a private address.

- **Outbound links.** Up to 100 distinct external links are requested, most-linked first so the capped set is the same on every crawl. The classification is conservative on purpose: only a 404, a 410 or a domain that no longer resolves is broken. A 403, a 429, a server error or a timeout is recorded as inconclusive and never reported, because most of those links work in a browser and "fix" would mean deleting a good citation. HEAD is never trusted alone; a server that answers HEAD with an error is asked again with GET.
- **Phone-width layout.** A sample of five pages, shallowest first, is rendered again at 375 pixels and the document's laid-out width measured. A viewport tag can be read from markup; sideways scrolling cannot, because one fixed-width table breaks a page whose tag is correct.
- **Image weight.** Each image's declared size and type are read with a HEAD request. Nothing is downloaded, and an undeclared size is unknown, never zero.

The image finding sits on the content axis and not on performance, and that placement is the design decision. Performance is scored only from real visitors' Core Web Vitals (ADR-0010). A heavy file is a likely cause to offer when that data is poor; it is never a reason to change a site real users already find fast, and a rule that lowered a field-data score from a file size would be Lighthouse by another route.

The eleven rules added alongside (missing and over-long titles, missing and shared descriptions, generic link text, thin pages, awkward addresses, dead outbound links, viewport, overflow, heavy images) each raise **one finding for the site with the pages listed**, not one per page: forty pages without a description is one problem with one fix, and forty rows would bury the three findings that can actually remove a site from Google. `docs/course-coverage.md` maps a standard introductory SEO syllabus onto the rule set and records where the audit deliberately disagrees with it: no word-count target, no keyword-density check, and no claim that structured data is a ranking factor.

### 1.19 Competitor watch reports the order of events, never a cause (ADR-0034)

The product this answers snapshots a competitor weekly and diffs their titles and headings. That is useful and it stops at "this changed". We already hold the other half: the daily poll records, for every check, which of a site's configured competitors the answer cited. So a change to a competitor's page can be set beside what their citations did around it.

The decisions are mostly refusals, and each has a reason:

- **A snapshot is what a parser reads off served HTML.** For each competitor: the title, meta description and first H1 of the homepage and up to eleven sitemap pages, and the URLs their sitemap declares. No model is involved, and a change is a string comparison after collapsing whitespace. This is ADR-0001 applied to somebody else's site.
- **A week that could not be read is never diffed**, so an outage cannot read as "everything changed". The first sighting of a sitemap reports no new URLs, because they are new to us and not to them.
- **Every fetch goes through the one SSRF guard**, because a competitor's hostname is text a tenant typed. Their robots.txt is read first and honoured; a disallow results in exactly one request, and a test asserts that count.
- **The read route fetches nothing, and there is no refresh button.** An authenticated request that makes the API call a caller-chosen host on demand is request forgery with a nicer name.
- **Storage is bounded by what is tracked, not by time.** Snapshots are gzipped and exist only to diff the next one against, so every write deletes all but the newest two per competitor. Changes are the history, and are pruned at 180 days. On one free-tier database (1.8) that is the difference between a feature and a slow leak.

The decision that names the ADR is about a sentence. A change followed by a citation gain is the most persuasive screen this product could show and the least supported: engines' answers move day to day on their own, and a competitor who rewrote one page probably changed several things that week. So the page gives two counts with their samples ("cited in 2 of 16 checks in the 7 days before, and cited in 3 of 26 checks in the 7 days after"), says "so far" while the second window is running, says "no checks ran" instead of "0 of 0", and always adds that one followed the other and that this is not evidence of a cause. No lift or percentage change is computed anywhere, so there is no figure for a reader to quote as one. One function writes that sentence, and its test fails on any causal word. The story's falsification condition is therefore a unit test, not a reviewer's memory.

### 1.20 The topic map's findings are decided by links and words (ADR-0035)

ADR-0024 allowed embeddings as an input to measurement: pages are embedded, grouped by a deterministic function of the vectors, and only then named by a model. The map was drawn on every audit after that and advised nothing, which is why it added no checks to any axis. It now raises two findings, and the line ADR-0024 drew is held in both: vectors may say which pages belong together, and whether that is a problem is decided by something a person can check with a browser.

- **A group of pages with no hub.** For each group of three or more pages, count for every member how many of the others it links to, from the links the crawler found. A group in which no page links to at least half of the others is raised on the structure axis.
- **A tracked question no page is about.** For each question the site tracks for AI visibility, test whether most of its subject words appear in the title or main heading of any crawled page. This uses no embedding at all.

The second is a deliberate departure from the plan, which was "a tracked question with no matching cluster". Built literally, that compares a one-line question with a page using a similarity threshold calibrated for page against page (ADR-0032), and its only evidence would be a number nobody can check without the model. The word test is cruder and it is checkable by reading. The vector version is recorded as deferred until someone calibrates it.

Neither finding reads a cluster's name, and a test asserts the name never appears in the finding. Neither is fixable by a pull request, because a hub page and an answer to a customer's question need facts only the business has. Each states how it can be wrong in its own falsification text: the grouping comes from text similarity and can be mistaken, and a page may answer the question in other words. Each adds a check to its axis only when it could run, so a site with no group of three pages is not credited with passing a test it never sat.

### 1.21 Billing is a seam, runs in test mode only, and buys one thing (ADR-0036)

The product has exactly one thing that costs money to run: the paid model and data calls that the cost guard already caps per tenant (1.13). So a plan sets that monthly cap and nothing else. No route, rule or page checks which plan an account is on; the guard goes on checking the number, and billing adds no second place where access is decided. It also means the pricing page cannot imply that pull requests are behind a paywall, because they are not.

The rail sits behind a `BillingProvider` interface with two methods: start a checkout, and verify and read a webhook. Stripe is the first adapter, written against `fetch` with no SDK. The market the research identified would more often pay by M-Pesa, which is why the seam matters, and the API routes are tested against a fake rail with no key and no network, so the same tests would hold for a second adapter.

The story's falsification condition is "a live charge is made in a demo". It is closed by construction. The adapter will not construct with a key that is not a test key, its webhook reader ignores any event the rail marks as live even when correctly signed, and the interface's `mode` has the single value `'test'`. There is no configuration of this deployment that takes real money.

Only the webhook changes a plan. Starting a checkout changes nothing, and neither does the browser returning from one, since anybody can type that address. The webhook is public, so it verifies an HMAC over the exact bytes received before parsing them and refuses a delivery more than five minutes old as a possible replay. Applying an event is idempotent, so a delivery repeated by the rail changes nothing the second time and no table of seen events is needed.

It is off unless an operator configures it, which is the state of the deployed product, and the account page says so.

### 1.22 The API limits request rate in memory, and counts signed-in traffic by account (ADR-0038)

A security review on 7 October found the data layer sound (bound parameters and row-level security on every query, tokens hashed, third-party credentials encrypted with AES-256-GCM, signed webhooks, an SSRF guard) and the outer edge of the API bare: no rate limit, no security headers, and CORS that reflected any origin.

**The limiter is a counter in the API process.** One Postgres and no Redis is the standing decision, the API is one instance, and counting requests in the database would turn a flood of requests into a flood of writes. The cost is stated: a restart forgets the counts, and more than one instance would make the limits per instance, which is the trigger to move them.

**Who is counted matters more than how many.** The web app calls the API from its own server, so signed-in traffic arrives from a few addresses however many people are using it. Signed-in requests are therefore counted per account, anonymous ones per address, and routes that call a model or a paid search are held tighter still. A request with a bad token is counted against nobody's account, so guessing at tokens cannot spend a real account's allowance.

The limiter guards availability; the monthly budget in Postgres still guards money. `SECURITY.md` lists every control with the file it lives in, and the limits it deliberately accepts.

---

## 2. Software and architectural patterns

This section addresses rubric requirement 2: the software and architectural patterns used, and the reasons for using them.

### 2.1 Strategy / Adapter: `VersionControlProvider`, `@seo/llm` providers, `SerpProvider`

All VCS access sits behind a `VersionControlProvider` interface, with `GitHubProvider` as the first implementation. The fixer logic asks the interface to open a pull request; it does not know it is talking to GitHub. Adding GitLab or Bitbucket is a new adapter, and no call site changes. The same shape confines every model vendor behind a provider interface (see 2.2), and, as of Sprint 3, confines SERP and AI-Overview data behind a `SerpProvider` so SerpApi and DataForSEO are interchangeable. The reason is direct: the parts of this product most likely to change (which VCS host, which model vendor, which SERP index) are exactly the parts a Strategy pattern keeps out of the call sites.

The AI-Overview engine is a small but instructive case of the pattern paying off twice. It is an adapter over the `SerpProvider` that presents it as one more `AiEngine` to the citation poller, so the poller stays ignorant of both the vendor and the fact that this particular engine is billed at all. It is named `ai_overview` rather than for the vendor, because that name is stored on every check row and forms half of the one-poll-per-engine-per-day key: renaming it on a vendor switch would fork one measurement window into two.

### 2.2 Role-based indirection for the LLM layer, enforced by CI (ADR-0005)

Application code addresses models by **role**, never by vendor: `fast` for high-volume extraction, `smart` for reasoning and code generation, `embed` for page embeddings, `judge` for grading the evaluation harness, and, added in Sprint 3, `poll` for the answer engines the AI-visibility axis measures. Roles resolve at runtime from environment variables as ordered fallback chains, for example `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro`.

The reason is that everything about a model changes on a quarterly cycle: our OpenAI credit will run out, free tiers appear and vanish, model names change, prices change. If provider and model names are scattered through the code, every one of those events becomes a pull request and a regression risk. Under this design, each is an environment edit. Three properties make it work, and all three are unit tested: a target whose API key is absent is silently dropped from the chain, so a chain can list five providers and use only the ones with keys; a retriable failure (429, quota, 5xx) falls through to the next target; and `packages/llm/src/providers.ts` is the only file in the codebase allowed to import a vendor SDK.

That last property is not left to discipline. An ESLint rule lists the vendor SDK package names as restricted imports and allow-lists exactly one file, so importing `@ai-sdk/openai` anywhere else fails the build. This is the same mechanism that enforces "only the API touches the database" (1.7): the architecture is a property of CI, not of anyone's memory.

`poll` is a separate role rather than a reuse of `smart`, for two reasons that both follow from it being a measurement instead of a generation. The model here is the *instrument*, so an operator wants to point it at whatever is closest to what their customers actually use, which is a different choice from "the best model for writing a fix". And it is the only role that spends every day, forever, so a separate variable makes a recurring bill something an operator switches on deliberately, and leaving it unset costs nothing and darkens one axis honestly.

### 2.3 Chain of responsibility: the LLM fallback chain

The ordered fallback chain is a chain of responsibility. Each target in `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro,groq:llama-3.3-70b-versatile` gets the request in turn; a retriable failure passes it to the next; a success stops the chain. The reason is graceful degradation: running out of OpenAI credit mid-demo falls back to a free tier instead of failing, and the free tier degrades rather than breaking.

### 2.4 Repository pattern: `packages/db`

Drizzle ORM is confined to `packages/db`. Domain logic does not issue ORM calls directly; it goes through `withTenant` and `asOwner`, which own the transaction and the tenant scoping. The reason is that tenancy becomes enforceable in exactly one place: every tenant-scoped read and write passes through a function that sets the tenant and drops to the non-privileged role, so a handler cannot forget to scope a query, because it never touches the ORM directly. `asOwner` is the single, loudly documented exception for operations that logically precede a tenant, such as creating a tenant, resolving an API token, or a system sweep across tenants like "which sites are due a poll today".

### 2.5 Decorator: the budgeted SERP provider

The cost guard wraps the vendor adapter rather than living inside it. `budgeted(provider)` returns a `SerpProvider` that checks the tenant's budget, delegates, and records the cost. The reason is the same reason the seam exists: a guard written inside SerpApi's adapter would have to be rewritten, correctly, in every adapter that follows, whereas wrapping means DataForSEO arrives already capped and the adapter stays a pure translation of one vendor's response shape.

The order inside the decorator is refuse, call, record, and each step is deliberate. Recording before the call would charge for queries that never happened. Recording only on success would let a vendor error *after* billing go uncounted, so the record happens in a `finally`: erring towards over-recording is the right direction for a cost guard, because the failure mode is a tenant reaching the cap slightly early rather than an unbounded loop of failing billable calls the ledger never sees. The guard's hooks are injected functions rather than a database handle, exactly as the LLM layer takes its checker and recorder, which keeps `packages/connectors` free of `@seo/db` and lets the whole thing be tested with no key, no database, and no spend.

### 2.6 The other patterns, briefly

| Pattern | Where | Reason |
|---|---|---|
| Pipeline / Chain | crawl, evaluate, prioritise, fix, verify | Each stage is independently testable and resumable. The audit runner is the one composition point where the stages meet; none of them knows about the others. |
| Registry | `packages/rules/src/registry.ts` | Rules self-register. Adding a rule touches one file, and `ruleCoverage()` is derived from the registry so it cannot drift. |
| Saga | The AI-visibility three-day poll; the CrUX 28-day verification window | Long-horizon stateful workflows that outlive any process, modelled as scheduled jobs rather than long-running ones. The poll saga is now built: one observation a day, accumulated into a verdict that no single run can produce. |
| Sweep | The daily poll's "who is due", the weekly competitor watch, the pull-request reconciler | Work that must survive an unreliable schedule is expressed as a query for what is overdue, not as a job for a date. A late run does the work late and an extra run finds nothing due. See 1.3. |
| Guard | `@seo/budget`, before any paid call | Cost blowout is the primary operational risk in a product that makes paid API calls, so the guard runs before the call and fails closed. See 1.13. |
| Discriminated union | `Evidence` (`http`, `markup`, `metric`, `file`, `graph`, `search`, `citation`) | A finding cannot record prose; it must hand back a typed observation a fixer can branch on and a verifier can re-observe. The `citation` variant carries the sample (polls run, days polled, matched sources) rather than a bare verdict, because a citation is a claim about a distribution and evidence for a bare "cited: true" would be evidence for a claim we refuse to make. |
| Dependency injection | `enqueue`, the OAuth config, the `fetch` in every connector, the `llm` client, the `SerpProvider`, the budget hooks | The routes, the audit runner, the fixers, and the pollers take their side effects as parameters, so a test drives them with a spy, a mocked endpoint, a fake model, or a fake vendor without the network and without spending. |

### 2.7 Strategy families: one fixer serves fourteen frameworks (ADR-0013)

The same finding needs a different diff in a different repository. "Add a tag to the head" is one file in a Next.js App Router `layout.tsx`, a different file in a Vue single-page app's `index.html`, a `header.php` in WordPress, a `baseof.html` in Hugo. The framework enum lists fourteen stacks, and writing one fixer per rule per framework is a combinatorial explosion that guarantees most cells are untested.

The pattern is Strategy, applied twice over. First, `detectFramework` reads a handful of known repository files (dependencies, config files, stack signatures like `wp-config.php` or `manage.py`) rather than the rendered page, because the HTML says "probably React" while the repository says "Next.js App Router", and only the second fact chooses the right file. Then each of the fourteen frameworks maps to one of **six head-injection strategy families** (framework-native head, single-page-app index, template hook, static-generator layout, server template, and a universal fallback), and a fixer implements one approach per family, not one per framework. An unrecognised repository resolves to the universal strategy and edits a root HTML document directly; `unknown` is a supported outcome, never a crash. This is the abstraction that makes "support every stack" tractable, and it is unit tested per framework against in-memory fixtures with no clone and no network.

---

## 3. Deployment options and cost implications

This section addresses rubric requirement 3: the deployment options, cloud or on-premises, with the relative cost implications of the choice. Figures are in USD per month and are realistic mid-range estimates for a small production workload (one always-on API, a worker fleet, one database of a few gigabytes, modest traffic).

### 3.1 Option A: the free tier (current deployment), $0/month infrastructure

| Component | Service | Monthly cost |
|---|---|---|
| Web app | Vercel Hobby | $0 |
| API | Render free web service | $0 |
| Database, queue, vectors, artefacts | Neon free (~0.5 GB) | $0 |
| Worker fleet | GitHub Actions on a public repo (unlimited minutes) | $0 |
| CI | GitHub Actions (public repo) | $0 |
| **Infrastructure total** | | **$0** |

This is what the project runs on today. The trade-offs are the accepted ceilings in section 1.8: the API sleeps after fifteen minutes idle and takes roughly thirty seconds to wake, the database is ~0.5 GB, and artefacts live in Postgres. All are fine for a capstone, a demo, and an early-stage product with a handful of tenants, and each has a documented trigger and path off it.

**Data costs sit on top of this, are opt-in, and are capped.** They are the only non-zero line in the whole system:

| Data source | Cost basis | Monthly cost at demo scale |
|---|---|---|
| Own crawler, rules, link graph, schema | free forever | $0 |
| Search Console, Site Verification, PageSpeed Insights, CrUX | free Google APIs | $0 |
| LLM calls (fix generation) | one `smart` call per fixable finding | pennies, on existing credit |
| LLM calls (`poll` role, AI visibility) | one call per prompt per day | ~$1 to $3 for 5 prompts on one site |
| SERP and AI Overviews (SerpApi) | 250 searches/month free, then per query | $0 at demo scale (5 prompts x 3 polls x 4 weeks = 60 searches) |
| **Default per tenant** | unset keys, both axes unmeasured | **$0** |
| **Hard cap per tenant** | enforced before the call (1.13) | **$5**, a database column |

The important property is not the size of those numbers but their shape: they are zero unless somebody opts in, and bounded by construction when they do.

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

Note that ElastiCache is optional. Because the queue is pg-boss on Postgres, a cloud deployment can keep the queue on RDS and drop the ~$13 Redis line entirely, which is one of the quiet benefits of the "no Redis" decision: it removes a cost line in every deployment tier, not just the free one. A high-availability setup (multi-AZ RDS, more workers) moves this into the $250 to $500 range. Data costs from 3.1 are unchanged by the hosting choice, because they are per query and not per server.

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

For the current stage (capstone, demo, early access), **the free tier is the correct choice** and the infrastructure total is genuinely zero. It is not a toy: the same code, the same database schema, and the same worker model scale up, because the only integration surface is `DATABASE_URL` and a set of environment variables.

When a ceiling in section 1.8 is reached, **migrate to managed cloud (Option B)**, one component at a time, following the documented triggers: artefacts to R2 or S3 first, then an always-on API, then a paid database tier. Because nothing in the code names a vendor SDK, each migration is configuration, not a rewrite.

**On-premises is recommended only under a specific constraint**, such as a data-residency or regulatory requirement that forbids a third-party host. Absent that constraint, its operations-labour cost makes it the most expensive option for a small SaaS, not the cheapest, and the intuition that "owning the hardware is cheaper" does not survive contact with the on-call rota.

---

## 4. Software testing carried out

This section addresses rubric requirement 4: all software testing carried out, including the automated tests, and the reasons for each. The suite is **2,018 automated tests across 153 test files**: 1,965 unit, integration, and contract tests in 140 files, plus 37 end-to-end tests, run on every push and pull request by CI. Those figures are from a full run on 7 October 2026. The suite has roughly doubled since Sprint 3, and the growth tracks where the risk moved: first to the four dark axes, then to the inbox queries when filtering moved into SQL, then to the agent that reads a repository (whose deterministic half, file selection and proposal validation, is where most of the 159 tests in `@seo/agent` sit), and most recently to the competitor watch and the topic findings.

### 4.1 Testing philosophy

Two principles shape the whole suite.

**Every finding carries its falsification condition, and the tests enforce it.** The domain model requires a non-empty `falsification` field on every finding, in three independent places: the TypeScript type will not compile without it, the Zod schema will not parse without it, and the database column is `NOT NULL`. A test constructs findings through the real engine and asserts the schema rejects an empty one, so "unfalsifiable advice" is not a guideline but a compile-and-runtime error.

**Where a claim can only be proven against real infrastructure, the test uses real infrastructure.** Row-level security is enforced by Postgres and by nothing else, so a mock would only test our beliefs about Postgres, and those beliefs were wrong once (section 1.6). The security tests, the queue tests, the API tests, the budget tests, the visibility window tests, and the end-to-end tests all run against a real Postgres. A mock there would be theatre. The clearest Sprint 3 example is the test that inserts a second poll for the same prompt, engine, and day and asserts the database rejects it: the "three polls over three days" guarantee is a claim about a unique index, so only the index can prove it.

### 4.2 The testing pyramid

| Layer | Count | What it covers | Why it exists |
|---|---|---|---|
| Unit | 118 of the 149 test files, the large majority of the 1,965 tests | The rule engine, the scorecard, the crawler's parsers and graph, the CrUX and quick-wins evaluators, the citation parser and stability aggregator, the consensus extractor, the visibility and authority evaluators, the LLM chain resolution, the token crypto and OAuth state, the framework detector, every fixer, the pull-request builders, the budget decorator, the evidence panel per variant, and the content and outreach drafters against fake models | Pure functions, fixture-driven, 100% deterministic, free to run. This is the bulk of the product's logic and involves zero external calls and zero spend. The evidence panel joins them by being extracted from its page: a component that turns props into markup is a pure function wearing a different hat, and rendering it through `react-dom/server` needs no DOM and no jsdom dependency. |
| Integration | 22 files | The audit runner end to end, the queue against Postgres, tenant isolation against Postgres, the crawler against a live HTTP server, the search step against Postgres with mocked Google, the visibility poll window against Postgres, the API against Postgres, the budget ledger against Postgres, the findings inbox's filtering, sorting and pagination against Postgres, two audits of one site recognising each other, and three weeks of competitor sweeps against Postgres | Prove the seams: the places where independently-tested packages meet, and the guarantees that live in the database rather than in the code. |
| Contract | 7 files | The CrUX client, the Search Console client, the Site Verification client, the SerpApi provider, the DataForSEO provider, the model SDK the LLM layer wraps, and the Stripe checkout request and webhook signature | These response shapes are somebody else's to change without warning, and the failure mode is not a crash but an axis that goes quiet while looking healthy. A contract test pins our reading of the shape so a vendor change surfaces as a red test. |
| End-to-end | 53 tests | The real Next app against the real API against real Postgres, with RLS on | The dashboard's acceptance criteria are claims about a screen; only a browser can check them, and the claims that matter most (a blank axis stays blank, another tenant gets a 404) are exactly what a mock would lie about. |
| LLM evaluation harness | 3 real sites, 50 pages, 232 claims | Precision, recall, and hallucination rate of findings against a hand-labelled golden dataset, with the judge asserted to be a different model family | It is the only place a false positive can appear, because a fixture has nothing on it but the thing under test. Precision 100%, recall 97.9%, pinned in CI. See 4.5. |

### 4.3 Per-package breakdown

| Package | Tests | Notable coverage |
|---|---|---|
| `@seo/crawler` | 224 | robots.txt matching (longest-match, tie-to-allow), sitemap parsing, the frontier and pacer, PageRank with dangling-mass redistribution, render comparison, AI-crawler posture, and a live-browser integration test against a real HTTP server, with a second local server standing in for the rest of the web so no test reaches the internet. That pair proves the post-crawl checks: a deleted page and a redirect to one are broken, a site that refuses crawlers is not, a server that answers HEAD wrongly is asked again with GET, a redirect aimed at a private address is vetted and never fetched, a page with a correct viewport tag and one fixed-width element measures over 800 pixels too wide, and image sizes are read by HEAD alone. |
| `@seo/connectors` | 324 | CrUX thresholds at the exact boundaries and the Core Web Vitals evaluator; token encryption (round-trip and tamper detection); OAuth state signing (forgery and replay); the two social identity providers and the sign-in state, including an unverified email never being preferred to a verified one and the protocol-relative open-redirect case; five contract tests; the citation parser including look-alike domain rejection; the stability aggregator including the same-day triple; the consensus range including outlier robustness; the visibility and authority evaluators; and the budget decorator. |
| `@seo/rules` | 181 | Every one of the forty-four deterministic rules, the engine, and the coverage report. The eleven page-level rules added in October assert their grouping (one finding per site, the pages listed) as well as their detection, and the corrections the golden dataset forced have a test each: a page answering 404 is not an orphan, and a login form is not thin content. Includes the property that matters most, "finds nothing on a clean site", and the rule-8 disclaimer assertion. |
| `@seo/api` | 341 | The outer defences against the assembled server (ADR-0038): the security headers are on a refusal, a missing route and a bad request as well as a success; one account's flood does not lock out another arriving from the same address; a bad token is counted against nobody and still refused; the health probes are never limited; an oversized body is a 413; and the limiter holds a bounded number of keys under a flood of distinct callers. Authentication (no header, bad token, and the "never trust an asserted tenant id" case), tenant isolation across the HTTP boundary (404 not 403), the enqueue paths for audits, verification, and fixes, the merge webhook, the fix-progress endpoint (in flight, opened, failed, and the property that it ships five scalars rather than the finding's evidence), the whole social sign-in round trip against Postgres (the nonce cookie and its flags, three ways a callback is refused, a redirect that carries no token, single-use exchange, the same account signing in twice keeping one tenant, and sign-out revoking the presented token and nothing else); the outreach drafter (the draft carries its own send policy, the model is told the given facts and nothing wider, a refusal is 422 rather than 500, and another tenant's 404 is answered without calling the model at all), the Google connection flow including forged-state rejection, and the visibility settings endpoints including the prompt-history-preserving diff. |
| `@seo/fixers` | 150 | The framework detector per stack, the head injector, and all ten registered fixers, each with a triggering and a clean fixture: the canonical origin rewrite (with the hostname-boundary guard), the robots AI-crawler unblock, the noindex strip, the `llms.txt` writer, the `LocalBusiness` schema block, the sitemap declaration, the sitemap entry, the mixed-content rewrite, the single-page-app catch-all rewrite, and the business-profile links added to an existing LocalBusiness block. Also `canFixFinding`, the single authority on whether a pull request can be opened at all. |
| `@seo/core` | 82 | The `Finding` schema and its falsification guarantee, the evidence union including the `citation` variant, the priority score, and the eight-axis scorecard including its refusal to score an unmeasured axis. |
| `@seo/audit` | 188 | The competitor watch (the diff's three refusals, the citation windows either side of a date, the snapshot reader against a fake site including the single request a robots.txt disallow allows, and three weeks of sweeps against Postgres proving two snapshots remain however many weeks pass and another tenant sees nothing); the two topic findings, written as the cases where each must stay silent; the seeded fixtures held to the rule that nothing is hand-drawn that a real code path produces; the runner producing and persisting a complete audit, the reachability guard, the performance and search steps and their honest unmeasured states, the fix-verification reconciliation, the visibility window against Postgres (four kinds of "nothing", the days-not-checks rule, and the duplicate-check rejection), and the findings query's filtering, sorting, and pagination in SQL: that a page is bounded and its total is the true total, that a percent sign in a search term is a literal rather than a `LIKE` wildcard, that a page size large enough to restore the unpaginated behaviour is refused, and that the query ships a count of affected URLs rather than the URLs themselves. |
| `@seo/vcs` | 110 | The branch naming and slug, the pull-request body builder refusing to render without all five sections, the provider's never-to-`main` guarantees and idempotency against a fake GitHub, and the webhook HMAC verification. |
| `@seo/agent` | 174 | The Search Console verification orchestration; the content fixer against a fake model; the outreach drafter, including that it refuses without a grounding fact, makes no call when it refuses, and returns nothing that could send an email; and the repository-reading agent of 1.16a, which is most of the count: file selection scored against the finding, the paths and credential-shaped content it refuses to read, the three context sizes, and every reason a proposal is thrown away before a pull request exists. |
| `@seo/db` | 18 | Tenant isolation, run against Postgres. Includes the assertion that would have caught the original bug: the query role has `rolbypassrls = false`. |
| `@seo/budget` | 14 | The cap against Postgres: accumulation, refusal at the cap, cross-tenant isolation, calendar-month reset, the recorder seam, the unpriced-model warning and its silence on genuinely free calls, and fail-closed when the ledger cannot be read. |
| `@seo/eval` | 34 | The scoring of one case (a matched claim as a true positive, a rule firing on the wrong page as a false positive rather than a hallucination, a finding about a page the crawl never saw as a hallucination), the null-safety that reports precision as null rather than 1 when nothing was found, micro-averaging so a two-label case cannot outweigh a forty-label one, and the judge-independence guard rejecting a same-family judge anywhere in the fallback chain. |
| `@seo/mcp` | 21 | The tool surface per mode (read tools only until writes are enabled, every tool described, `keyword_ideas` marked not read-only because it spends money), the shapes the tools return (a findings row led by the `rowId` that `fix_finding` takes, never the affected URLs themselves), and the pull-request cap, including that one budget is shared across both PR-opening tools and that refusing does not call the API. |
| `@seo/llm` | 22 | Chain resolution: absent keys dropped, fallback order preserved, a helpful error when no key is present, a model that says it is busy treated as temporary whatever words it uses, and a contract test over the SDK the layer wraps. |
| `@seo/web` (unit) | 68 | The one function every screen reports a failure through (a server fault message is never shown, a 409 is something to correct and not our fault, anything thrown at all gets a title and a way forward); the setup count the dashboard and the site setup page share; the check on an address carried through sign-in. The sentence that sets a competitor's citations beside a change, including the test named for the story's falsification condition: however flattering the numbers, it contains no causal word and no percentage. The API-error handling that decides between a redirect and a retry message, and the evidence panel per variant: every kind of the union renders non-empty markup, the citation panel states its k-of-N count, its matched sources, its competitors and its consensus range, and a fixture is parsed through the real `evidenceSchema` so no test can pass on a shape production would reject. |
| `@seo/queue` | 9 | Enqueue and drain, and the concurrency guarantee that a job goes to only one of two racing drains. |
| `@seo/api-client` | 5 | The typed client's request handling, including the timeout and the JSON content-type only when there is a body. |
| `@seo/web` (e2e) | 53 | The security headers on every page, ten real pages and a dialog loading under the content policy with no refusal reported by the browser, and the app refusing to be framed. Onboarding (an account with no site lands in setup and not on an empty dashboard, an address typed before sign-in is waiting after it, details saved there are the details site setup shows, a suggested-competitor request with no model says so and typing still works) and the authority page (the three lists are tabs, no email form exists until one is asked for, the composer offers nothing that sends, the fact is kept for the next publication). Competitor watch on the seeded tenant with history (the changes, the counts with their samples, the denial of cause, and no causal word in the batch) and its empty state; the topics page showing the measured groups and the advice they produced, and saying so when topics were not measured; the dashboard, the findings inbox, the scorecard's honest blanks (and its refusal to show a single overall score), the backlog leading with the critical finding rather than the cheap one, a finding showing its falsification condition, and cross-tenant 404, all in a real browser. Those added with the app shell: an old bookmarked `/dashboard/findings/:id` URL still resolves, the breadcrumb trail leads back to the inbox, a filter lands in the query string and narrows the table, the status column is on screen, the research pages say unmeasured rather than zero, and the nav reaches every section while keeping the site you picked. |

### 4.4 Tests that earned their keep by catching real defects

The suite is not decorative. Several tests failed on correct-looking code and prevented a real defect from shipping. These are documented because they are the strongest evidence that the tests are worth their cost:

- **The `BYPASSRLS` discovery (section 1.6).** The test that asserts the query role cannot bypass RLS is the test that revealed the entire tenant-isolation scheme was inert. It is now the first assertion in the security suite.
- **Confidently scoring a site never reached.** A test drove an audit of an unreachable host and found the runner produced a full scorecard from a single dead page, reporting "no sitemap" about a server that never answered. The runner now refuses to score a site it never saw.
- **The `onRequest` authentication leak.** A test showed that authenticating in Fastify's `preHandler` let an anonymous caller receive a 400 (revealing a route's schema) before the 401, because validation runs first. Authentication moved to `onRequest`.
- **An empty login shell.** A test caught the login page rendering as blank HTML because `useSearchParams` had silently opted the route out of server rendering.
- **A build-time environment variable read at runtime.** The end-to-end suite caught `NEXT_PUBLIC_API_URL` being inlined at build time, so a deployed app would dial whatever URL it was compiled with.
- **A consensus range nobody had stated (Sprint 3).** The consensus extractor originally took a plain median, and its own test showed two answers quoting $3,000 and $4,000 collapsing into a "consensus" of $3,500 to $3,500: a figure neither answer gave, presented as agreement, with the disagreement hidden. The statistic was changed so the two medians lean outwards, which means every endpoint is now a figure some answer really stated.
- **The exhaustive evidence switch (Sprint 3).** Adding the `citation` evidence variant broke the build in `pr-body.ts`, because the renderer's switch is exhaustive over the union. The type system, rather than a reviewer, insisted that a new kind of evidence be given a way to appear in a pull-request body.
- **A stale rationale in the scorecard (Sprint 3).** Writing ADR-0019 surfaced a comment asserting the `llms.txt` finding scored zero, referencing a rule id that no longer existed. Checking which of the two was right (the code) rather than making them agree is documented in 1.15.

- **The golden dataset, four times (October).** Fifty real pages were labelled from their stored bytes before the harness ran, and four of its disagreements were the engine's fault. It reported that a site **had** an `llms.txt` when it did not, because a single-page app answers `/llms.txt` with its HTML shell and a 200. It proposed twenty pages that answer 404 as the contents of the `llms.txt` it would write. It called a sitemap URL that answers 404 an orphan and advised linking to it. And it called a sixteen-word login form thin content. No fixture would have found any of these, because a fixture contains only what its author thought of. Section 4.5 has the numbers.
- **A redirect target that was already queued (October).** The test for the crawler's new "do not fetch a page an earlier address redirected to" method failed on the first implementation, which returned early in exactly the case it existed for: the target had already been queued by a link.
- **Two audits that did not recognise each other (October).** The identity work in 1.16 is proven by running two real audits of one site against real Postgres and asserting the second carries the first's first-seen time and won't-fix decision, links to its pull request without copying it, and computes the same fingerprint as the migration's SQL backfill. That last assertion exists because a silent disagreement between the two would stop every earlier finding being recognised.
- **A disconnect during verification (October).** A test replaces the audit step with one that removes the site's hosting connection mid-run and returns a clean re-crawl, which is precisely the result that would otherwise be saved as verified. The finding stays merged.

### 4.4a What the suite did not catch, and what that says about its shape

A section listing only the tests that worked would be advocacy rather than analysis. Two defects reached `main` past the entire gate, and both are informative about where this suite's blind spots are.

**Five desktop layout faults, caught only by looking.** The worst was a CSS specificity fight: the mobile navigation bar carried `className="nav md:hidden"`, where `.classical .nav` sets `display: flex` at specificity (0,2,0) and Tailwind's `md:hidden` sets `display: none` at (0,1,0). The lower-specificity rule loses regardless of the media query, so the bar never hid on desktop, and because it was a flex child of the shell row it also ate a slice of the sidebar's width. This passed the type checker, the linter, the full unit suite, and eleven end-to-end assertions, because **not one of those tools can see**. The end-to-end tests assert that elements exist and that text is present, which is exactly what was true: the element existed, in the wrong place. The response was not more assertions but a different instrument, a screenshot harness (`apps/web/e2e/screens.manual.ts`) that renders every screen at desktop, mobile, and dark and is run when a change needs to be *seen* rather than asserted. It is deliberately excluded from CI's `testMatch`, because a machine writing PNGs nobody looks at is cost without signal.

**A blank evidence panel on the flagship axis.** The `citation` evidence variant was added in Sprint 3 and rendered in the pull-request body, but never in the dashboard. The finding detail page's `EvidenceBlock` switched over the other six variants and simply fell off the end, and because its return type was inferred rather than declared, TypeScript widened it to include `undefined`, which React accepts as a legal child and renders as nothing. So every AI-visibility finding displayed its evidence section empty, and the whole gate stayed green.

The contrast with the entry above it is the lesson. The identical omission in `pr-body.ts` broke the build the day it was introduced, because that function returns `string` and has nowhere to hide an `undefined`. **The difference was one type annotation, not one test.** The fix was to declare the return type as `React.ReactElement`, which turns any future unhandled variant into `TS2366` at compile time, and this was verified by removing the new case and confirming the build fails. That is the same technique as the four architectural ESLint rules in 4.6: the cheapest test is the one the compiler runs for free on every keystroke, and a discriminated union is only as safe as the annotation on the function consuming it.

The compiler can only prove that every variant returns *something*, though, not that what it returns is worth reading, so the panel was also extracted out of its page into `components/evidence.tsx` and given the sixteen tests it never had. They assert what each variant actually puts on screen, and one of them is a property rather than an example: every kind in the union must render non-empty markup, which is the precise symptom that went unnoticed. Both halves of the guard were then checked the same way, by deleting the `citation` case and confirming the build fails and eight tests go red.

**A table that only overflowed when it had something in it.** The interface was rebuilt in October on a new structure, checked with the screenshot harness in light, dark and mobile, and merged with every check green. It was wrong in a way the harness could not show, because the seeded tenant is deliberately sparse: one audit, two findings, nothing connected. The findings table fitted its frame with two short rows. With a row carrying two status tags it pushed the priority, page count and action columns out of view at 1440 pixels. Outcome cards, share of voice, the authority lists and the spend bar had the same problem in a milder form: they had only ever been seen as empty states.

The response was again a different instrument, not more assertions: a second seeded tenant with history, whose rows are written by the product's own functions (rule text from the rules, fixability from the fixers, fingerprints, baselines and verification records from the functions the worker calls, competitor changes from two runs of the real sweep). A fixture that is "invented but plausible" is the worst thing a fixture can be, since every screenshot and demo is taken against it, so three unit tests hold it to that. It is a separate tenant so that no existing assertion moves: the end-to-end suite counts the first tenant's rows and row-level security means it cannot see these. The defect was found the first time the populated screen was opened.

**An assertion that asserted nothing.** One of the competitor-watch end-to-end tests was written through a shell that stripped its backslashes, leaving `toHaveAttribute('href', //visibility?siteId=/, )`. The second argument had become a comment, so the test checked only that the link had an `href` at all, and it passed. It was caught by reading the file, not by any tool, and it is recorded because a green test proves only that its assertions held, and says nothing about whether they were the assertions the author meant. The same slip turned `\d` into `d` in a sibling test, which failed loudly; the dangerous one was the one that passed.

### 4.5 The LLM evaluation harness

The deterministic rule engine (section 1.1) is what makes most of the product testable by ordinary means, because a parser is a pure function. The probabilistic half now exists in two places: the model writes a fix in the content fixer, and it drafts outreach on the authority axis. Both are tested by ordinary means, against fake models that return canned output, which proves the mechanism (exactly one call, schema-validated, grounded on real facts, and a graceful nothing on failure) without spending a token or depending on a live model. The outreach test goes one step further and parses its canned output through the caller's own schema, so a test cannot pass on a shape production would reject.

What a fake cannot measure is the quality of what a real model writes, and that is what the evaluation harness is for. It is built, and it lives in `packages/eval`. It runs the finding engine against a golden dataset of pages with known, hand-labelled ground-truth issues and measures three numbers: **precision** (of the findings raised, how many are real), **recall** (of the real issues, how many were found), and **hallucination rate** (findings that reference code or elements that do not exist). Prompts are snapshot-tested, so a rewrite has to be argued about rather than slipped in. In production the harness gains two further numbers: pull-request merge rate and pull-request revert rate, the ultimate ground truth for whether a fix was correct. Both are now computed per site from the recorded outcome of every agent pull request (merged, closed unmerged, or merged then reverted through GitHub's Revert button) and shown on the Outcomes page; integration tests drive the real webhook for each case.

One methodological decision is already enforced in code and tested: the `judge` role that grades the harness **must be a different model family than the model under test**. Grading OpenAI's output with OpenAI produces self-preference bias and an evaluation that flatters itself. The role-based LLM layer (section 2.2) makes this a one-line configuration (`LLM_JUDGE=google:gemini-2.5-pro` while the fixer runs on OpenAI), the chain-resolution tests prove the layer routes each role independently, and the harness asserts the independence rather than assuming it.

The dataset is no longer the missing half. It holds three real sites, captured with a browser so the rendered DOM is stored beside the served HTML: 50 pages and 232 claims. Two of the three are single-page apps, which is why the format had to grow a rendered snapshot; without one, every page of each is the same empty shell and nothing that only exists after rendering can be labelled or graded.

| | first run | after going back to the bytes |
|---|---|---|
| precision | 91.4% | 100.0% |
| recall | 87.8% | 97.9% |
| hallucination rate | 0% | 0% |

The rule that governs it is that a page is never labelled from engine output; the engine's findings are only ever a reason to go and read the page. The labels were written from the stored bytes with plain regular expressions, not the product's parser, before the harness was run. What makes the second column worth more than a round number is that the disagreements went **both ways**. Four were engine errors, listed in 4.4 and now fixed with a regression test each. Four were label errors: a page that really was thin, miscounted because the count included the title; two rules that did not exist when the first case was labelled; a URL that was in the sitemap and not linked; and a claim cleared too quickly. Each was settled by reading the bytes again.

Five true claims remain missed, on purpose. The rule that reports a page as empty until JavaScript runs will not judge a page with fewer than fifty rendered words, so that an error page cannot trip a ratio on a handful of words. On a site where every route is an empty shell the claim is still true of the 404 page and the login form, so they are labelled, and they are missed. Unlabelling them would make recall 100% and the dataset slightly less honest.

Two properties are now enforced by CI rather than by intention. A site-wide fact, such as a missing `llms.txt`, is scored once and not once per page the rule happens to list. And the dataset test fails on any claim a person has not checked, or any miss beyond the known five, so adding or changing a rule forces someone to open real pages and decide.

The limits are stated in `packages/eval/README.md` and are real: three small sites from one country, two of them single-page apps, labelled by one person who also wrote several of the rules. Fifty pages is what the story asked for and is still a narrow sample. The production numbers described above, pull-request merge rate and revert rate, remain the ground truth that a dataset can only approximate.

### 4.6 Continuous integration

Every push and every pull request runs the full gate: format check, lint, typecheck, build, database migration, the full unit, integration, and contract suite, and the 53 end-to-end tests. CI provisions a real Postgres 18 service container for the tests that need one, deliberately a different Postgres from Neon, because the container's default role is a superuser and superusers also bypass RLS, so if the `seo_app` role drop were broken the isolation tests would fail in CI rather than in production. The migration step runs before the tests, because the isolation suite has nothing to assert against until the schema and the policies exist.

Four code-level laws are enforced mechanically by the same pipeline: no vendor SDK outside `providers.ts`, no `@seo/db` import outside the API, the worker, the audit runner, and the budget package, no finding without a falsification condition, and no `llms.txt` recommendation that claims a ranking benefit. The architecture is not a document the code is asked to honour; it is a set of checks the code must pass. A third-party reviewer (Sourcery) also runs on every pull request; its comments are read before merge, and it has caught real defects, including a homepage meta description that was present but empty slipping past its own rule.

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
| 0011 | Deterministic-first fix generation | Accepted |
| 0012 | Pull-request safety and idempotency | Accepted |
| 0013 | Framework-strategy pattern for fixers | Accepted |
| 0014 | GitHub App webhook security | Accepted |
| 0015 | Citation measurement is poll-many-times-over-days, and deterministic | Accepted |
| 0016 | Third-party SERP data behind a provider, under a per-tenant budget cap | Accepted |
| 0017 | The cost guard is enforced before the spend, per tenant, in its own package | Accepted |
| 0018 | The authority axis leads with mentions, not links | Accepted |
| 0019 | `llms.txt` is agent-readiness infrastructure, never a ranking claim | Accepted |
| 0020 | The MCP server is a second door, and it goes through the API | Accepted |
| 0021 | A seam per product line, not per vendor; links are a second signal | Accepted |
| 0022 | `fixable` is a promise, and a failed fix has to say so | Accepted |
| 0023 | Social sign-in mints an API token, rather than introducing a session | Accepted |
| 0024 | Embeddings may measure; the model may only name what was measured | Accepted |
| 0025 | One anonymous door, and a hard limit on what it may touch | Accepted; amends 0009 |
| 0026 | Neon's six-hour restore window is the retention policy, with a weekly restore drill | Accepted |
| 0027 | Read repository deployment evidence through the GitHub App | Accepted; extends 0002 |
| 0028 | Hosting credentials belong to the site, not to the operator | Accepted; narrows 0027 |
| 0029 | A finding is the same finding on the next audit | Accepted |
| 0030 | The agent reads the repository and proposes the fix | Accepted; supersedes part of 0011 |
| 0031 | The agent's context shrinks to fit the model | Accepted; amends 0030 |
| 0032 | The topic threshold belongs to the embedding model | Accepted; amends 0024 |
| 0033 | Hosting is connected by consent, and the project is found, not typed | Accepted; extends 0028 |
| 0034 | Competitor watch reports the order of events, never a cause | Accepted |
| 0035 | The topic map's findings are decided by links and words, not by vectors | Accepted; extends 0024 |
| 0036 | Billing is a seam, runs in test mode only, and buys one thing | Accepted |
| 0037 | An axis score counts causes, not pages | Accepted |
| 0038 | The API limits request rate in memory, and counts signed-in traffic by account | Accepted |

The ADRs are the primary source; this document summarises them and adds the deployment-cost and testing analysis the rubric requires. Where the two differ, the ADRs win, because they are never edited after acceptance and this document is regenerated.
