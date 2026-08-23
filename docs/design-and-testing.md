# Design and Testing Document

**Project:** Rankwright, an autonomous SEO agent
**Programme:** Quantic School of Business and Technology, MSSE Capstone
**Scope of this document:** the design and architecture decisions, the software and architectural patterns used, the deployment options with their cost implications, and the testing carried out. It is generated from the nineteen Architecture Decision Records in `docs/adr/`, the architecture map in `docs/architecture.md`, the CI configuration, and every test in the repository. It reflects the system through Sprint 3, in which the four dark axes were lit: AI visibility is measured by polling answer engines over days, authority leads with brand mentions, and agent readiness and local are read from the crawl. Sprint 3 also introduced the product's first paid dependency and the cost guard that contains it.

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
- **Testability.** A pure function reaches 100% unit coverage against fixtures. The rule engine is 81 tests over deterministic inputs, and that is the majority of the product's logic.
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

The scheme has since absorbed four new tables without amendment, which is the property a good tenancy model should have: `visibility_prompts`, `visibility_checks`, and `spend` each arrived with `tenant_id`, a policy, and a grant, and the isolation tests covered them by construction rather than by anyone remembering to extend the suite.

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
| ~~No backlink index, so referring domains are unmeasured~~ **Trigger pulled (ADR-0021).** A `BacklinkProvider` seam with a DataForSEO adapter now measures referring domains when credentials are configured, and reports them unmeasured when they are not. Mentions still lead the axis. | — | — |
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

This section addresses rubric requirement 4: all software testing carried out, including the automated tests, and the reasons for each. The suite is **716 automated tests across 66 test files**: 705 unit, integration, and contract tests plus 11 end-to-end tests, run on every push and pull request by CI. It grew by roughly a third in Sprint 3 as the four dark axes landed: the citation parser and stability aggregator, the consensus extractor, the visibility and authority evaluators, the SERP contract and its budget decorator, the cost guard, and the outreach drafter each arrived with tests. It grew again in the interface work that followed, almost entirely in two packages: moving the findings inbox's filtering, sorting, and pagination out of the application and into SQL put the burden on `@seo/audit`'s queries and the API's route contracts, and both gained tests in proportion.

### 4.1 Testing philosophy

Two principles shape the whole suite.

**Every finding carries its falsification condition, and the tests enforce it.** The domain model requires a non-empty `falsification` field on every finding, in three independent places: the TypeScript type will not compile without it, the Zod schema will not parse without it, and the database column is `NOT NULL`. A test constructs findings through the real engine and asserts the schema rejects an empty one, so "unfalsifiable advice" is not a guideline but a compile-and-runtime error.

**Where a claim can only be proven against real infrastructure, the test uses real infrastructure.** Row-level security is enforced by Postgres and by nothing else, so a mock would only test our beliefs about Postgres, and those beliefs were wrong once (section 1.6). The security tests, the queue tests, the API tests, the budget tests, the visibility window tests, and the end-to-end tests all run against a real Postgres. A mock there would be theatre. The clearest Sprint 3 example is the test that inserts a second poll for the same prompt, engine, and day and asserts the database rejects it: the "three polls over three days" guarantee is a claim about a unique index, so only the index can prove it.

### 4.2 The testing pyramid

| Layer | Count | What it covers | Why it exists |
|---|---|---|---|
| Unit | 52 files, the large majority of tests | The rule engine, the scorecard, the crawler's parsers and graph, the CrUX and quick-wins evaluators, the citation parser and stability aggregator, the consensus extractor, the visibility and authority evaluators, the LLM chain resolution, the token crypto and OAuth state, the framework detector, every fixer, the pull-request builders, the budget decorator, the evidence panel per variant, and the content and outreach drafters against fake models | Pure functions, fixture-driven, 100% deterministic, free to run. This is the bulk of the product's logic and involves zero external calls and zero spend. The evidence panel joins them by being extracted from its page: a component that turns props into markup is a pure function wearing a different hat, and rendering it through `react-dom/server` needs no DOM and no jsdom dependency. |
| Integration | 8 files | The audit runner end to end, the queue against Postgres, tenant isolation against Postgres, the crawler against a live HTTP server, the search step against Postgres with mocked Google, the visibility poll window against Postgres, the API against Postgres, and the budget ledger against Postgres | Prove the seams: the places where independently-tested packages meet, and the guarantees that live in the database rather than in the code. |
| Contract | 4 files | The CrUX client, the Search Console client, the Site Verification client, and the SerpApi provider | These response shapes are somebody else's to change without warning, and the failure mode is not a crash but an axis that goes quiet while looking healthy. A contract test pins our reading of the shape so a vendor change surfaces as a red test. |
| End-to-end | 11 tests | The real Next app against the real API against real Postgres, with RLS on | The dashboard's acceptance criteria are claims about a screen; only a browser can check them, and the claims that matter most (a blank axis stays blank, another tenant gets a 404) are exactly what a mock would lie about. |
| LLM evaluation harness | designed | Precision, recall, and hallucination rate of findings against a golden dataset | See 4.5. |

### 4.3 Per-package breakdown

| Package | Tests | Notable coverage |
|---|---|---|
| `@seo/crawler` | 152 | robots.txt matching (longest-match, tie-to-allow), sitemap parsing, the frontier and pacer, PageRank with dangling-mass redistribution, render comparison, AI-crawler posture, and a live-browser integration test against a real HTTP server. |
| `@seo/connectors` | 131 | CrUX thresholds at the exact boundaries and the Core Web Vitals evaluator; token encryption (round-trip and tamper detection); OAuth state signing (forgery and replay); four contract tests; the citation parser including look-alike domain rejection; the stability aggregator including the same-day triple; the consensus range including outlier robustness; the visibility and authority evaluators; and the budget decorator. |
| `@seo/rules` | 81 | Every one of the twenty-three deterministic crawl rules, the engine, and the coverage report. Includes the property that matters most, "finds nothing on a clean site", and the rule-8 disclaimer assertion. |
| `@seo/api` | 86 | Authentication (no header, bad token, and the "never trust an asserted tenant id" case), tenant isolation across the HTTP boundary (404 not 403), the enqueue paths for audits, verification, and fixes, the merge webhook, the Google connection flow including forged-state rejection, and the visibility settings endpoints including the prompt-history-preserving diff. |
| `@seo/fixers` | 54 | The framework detector per stack, the head injector, and each fixer with a triggering and a clean fixture: the canonical origin rewrite (with the hostname-boundary guard), the robots AI-crawler unblock, the noindex strip, the `llms.txt` writer, and the `LocalBusiness` schema block. |
| `@seo/core` | 43 | The `Finding` schema and its falsification guarantee, the evidence union including the `citation` variant, the priority score, and the eight-axis scorecard including its refusal to score an unmeasured axis. |
| `@seo/audit` | 50 | The runner producing and persisting a complete audit, the reachability guard, the performance and search steps and their honest unmeasured states, the fix-verification reconciliation, the visibility window against Postgres (four kinds of "nothing", the days-not-checks rule, and the duplicate-check rejection), and the findings query's filtering, sorting, and pagination in SQL: that a page is bounded and its total is the true total, that a percent sign in a search term is a literal rather than a `LIKE` wildcard, that a page size large enough to restore the unpaginated behaviour is refused, and that the query ships a count of affected URLs rather than the URLs themselves. |
| `@seo/vcs` | 32 | The branch naming and slug, the pull-request body builder refusing to render without all five sections, the provider's never-to-`main` guarantees and idempotency against a fake GitHub, and the webhook HMAC verification. |
| `@seo/agent` | 20 | The Search Console verification orchestration; the content fixer against a fake model; and the outreach drafter, including that it refuses without a grounding fact, makes no call when it refuses, and returns nothing that could send an email. |
| `@seo/db` | 10 | Tenant isolation, run against Postgres. Includes the assertion that would have caught the original bug: the query role has `rolbypassrls = false`. |
| `@seo/budget` | 9 | The cap against Postgres: accumulation, refusal at the cap, cross-tenant isolation, calendar-month reset, the recorder seam, the unpriced-model warning and its silence on genuinely free calls, and fail-closed when the ledger cannot be read. |
| `@seo/llm` | 6 | Chain resolution: absent keys dropped, fallback order preserved, a helpful error when no key is present. |
| `@seo/web` (unit) | 22 | The API-error handling that decides between a redirect and a retry message, and the evidence panel per variant: every kind of the union renders non-empty markup, the citation panel states its k-of-N count, its matched sources, its competitors and its consensus range, and a fixture is parsed through the real `evidenceSchema` so no test can pass on a shape production would reject. |
| `@seo/queue` | 5 | Enqueue and drain, and the concurrency guarantee that a job goes to only one of two racing drains. |
| `@seo/api-client` | 4 | The typed client's request handling, including the timeout and the JSON content-type only when there is a body. |
| `@seo/web` (e2e) | 11 | The dashboard, the findings inbox, the scorecard's honest blanks, and cross-tenant 404, all in a real browser. The four added with the app shell: an old bookmarked `/dashboard/findings/:id` URL still resolves, the breadcrumb trail leads back to the inbox, a filter lands in the query string and narrows the table, and the status column is on screen. |

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

### 4.4a What the suite did not catch, and what that says about its shape

A section listing only the tests that worked would be advocacy rather than analysis. Two defects reached `main` past the entire gate, and both are informative about where this suite's blind spots are.

**Five desktop layout faults, caught only by looking.** The worst was a CSS specificity fight: the mobile navigation bar carried `className="nav md:hidden"`, where `.classical .nav` sets `display: flex` at specificity (0,2,0) and Tailwind's `md:hidden` sets `display: none` at (0,1,0). The lower-specificity rule loses regardless of the media query, so the bar never hid on desktop, and because it was a flex child of the shell row it also ate a slice of the sidebar's width. This passed the type checker, the linter, the full unit suite, and eleven end-to-end assertions, because **not one of those tools can see**. The end-to-end tests assert that elements exist and that text is present, which is exactly what was true: the element existed, in the wrong place. The response was not more assertions but a different instrument, a screenshot harness (`apps/web/e2e/screens.manual.ts`) that renders every screen at desktop, mobile, and dark and is run when a change needs to be *seen* rather than asserted. It is deliberately excluded from CI's `testMatch`, because a machine writing PNGs nobody looks at is cost without signal.

**A blank evidence panel on the flagship axis.** The `citation` evidence variant was added in Sprint 3 and rendered in the pull-request body, but never in the dashboard. The finding detail page's `EvidenceBlock` switched over the other six variants and simply fell off the end, and because its return type was inferred rather than declared, TypeScript widened it to include `undefined`, which React accepts as a legal child and renders as nothing. So every AI-visibility finding displayed its evidence section empty, and the whole gate stayed green.

The contrast with the entry above it is the lesson. The identical omission in `pr-body.ts` broke the build the day it was introduced, because that function returns `string` and has nowhere to hide an `undefined`. **The difference was one type annotation, not one test.** The fix was to declare the return type as `React.ReactElement`, which turns any future unhandled variant into `TS2366` at compile time, and this was verified by removing the new case and confirming the build fails. That is the same technique as the four architectural ESLint rules in 4.6: the cheapest test is the one the compiler runs for free on every keystroke, and a discriminated union is only as safe as the annotation on the function consuming it.

The compiler can only prove that every variant returns *something*, though, not that what it returns is worth reading, so the panel was also extracted out of its page into `components/evidence.tsx` and given the sixteen tests it never had. They assert what each variant actually puts on screen, and one of them is a property rather than an example: every kind in the union must render non-empty markup, which is the precise symptom that went unnoticed. Both halves of the guard were then checked the same way, by deleting the `citation` case and confirming the build fails and eight tests go red.

### 4.5 The LLM evaluation harness

The deterministic rule engine (section 1.1) is what makes most of the product testable by ordinary means, because a parser is a pure function. The probabilistic half now exists in two places: the model writes a fix in the content fixer, and it drafts outreach on the authority axis. Both are tested by ordinary means, against fake models that return canned output, which proves the mechanism (exactly one call, schema-validated, grounded on real facts, and a graceful nothing on failure) without spending a token or depending on a live model. The outreach test goes one step further and parses its canned output through the caller's own schema, so a test cannot pass on a shape production would reject.

What a fake cannot measure is the quality of what a real model writes, and that is what the evaluation harness is for. The harness is a golden dataset of roughly fifty pages with known, hand-labelled ground-truth issues. Against it, the harness measures three numbers: **precision** (of the findings raised, how many are real), **recall** (of the real issues, how many were found), and **hallucination rate** (findings that reference code or elements that do not exist). In production it adds two more: pull-request merge rate and pull-request revert rate, the ultimate ground truth for whether a fix was correct, and both are now observable because the write path and the merge-and-verify loop are built.

One methodological decision is already enforced in code and tested: the `judge` role that grades the harness **must be a different model family than the model under test**. Grading OpenAI's output with OpenAI produces self-preference bias and an evaluation that flatters itself. The role-based LLM layer (section 2.2) makes this a one-line configuration (`LLM_JUDGE=google:gemini-2.5-pro` while the fixer runs on OpenAI), and the chain-resolution tests already prove the layer routes each role independently. What remains is the golden dataset itself and the harness runner; the fix generation they grade is now live, so the harness is the next instrument to build rather than a design waiting on its subject.

### 4.6 Continuous integration

Every push and every pull request runs the full gate: format check, lint, typecheck, build, database migration, the full unit, integration, and contract suite, and the 11 end-to-end tests. CI provisions a real Postgres 18 service container for the tests that need one, deliberately a different Postgres from Neon, because the container's default role is a superuser and superusers also bypass RLS, so if the `seo_app` role drop were broken the isolation tests would fail in CI rather than in production. The migration step runs before the tests, because the isolation suite has nothing to assert against until the schema and the policies exist.

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

The ADRs are the primary source; this document summarises them and adds the deployment-cost and testing analysis the rubric requires. Where the two differ, the ADRs win, because they are never edited after acceptance and this document is regenerated.
