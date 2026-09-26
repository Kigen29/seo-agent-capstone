# Repair and roadmap implementation

Status is evidence-based: checked items are implemented, not necessarily deployed. PRs #177 and #178 are merged; shared-project migrations through 0024 and post-merge CI passed. Last reconciled: 2026-09-26. Infrastructure deployment and external-provider acceptance remain separate release gates.

## Foundation and immediate repairs

- [x] Shared same-origin redirect validator; regression: core safe-next tests.
- [x] Explicit local-only fixture database boundary; regression: core test-database tests.
- [x] Disposable Postgres compose definition and CI fixture flags.
- [x] MCP reserves PR capacity before concurrent calls; regression: MCP tools tests.
- [x] Server-side 30-day browser-session age enforcement; regression: expired/current browser sessions and older API tokens in API integration tests.
- [x] Optional GitHub reconciliation no longer blocks unrelated work when unconfigured.
- [x] Login provider outage distinguished from an empty configuration.
- [x] Keywords respect selected site and preserve it on form submission.
- [x] Request-scoped site-list deduplication in layout and dashboard.
- [x] Production dependency audit reports zero advisories after compatible package updates and the scoped SDK transport override; see validation below.
- [ ] Full release validation: workspace CI and all 14 browser tests pass; load, recovery, deployment and external-provider acceptance gates remain open.

## Security

- [x] GitHub user OAuth confirms installation access before attachment; connector authorization and API callback tests.
- [x] Stored PR/repository/installation binding for fix webhooks; verification webhooks also match these fields. Fix transitions lock the matching site/finding and reject mismatched or incomplete events. Tracked in GitHub issue #180.
- [ ] Resolver-pinned HTTP transport and isolated browser egress.
- [ ] Session management, explicit API-token expiration and revocation.
- [ ] Atomic anonymous quotas and trusted proxy configuration.

## Reliability and correctness

- [ ] Transactional outbox, queue uniqueness, crash/reorder regression tests.
- [ ] Stable finding identities and persisted fix attempts.
- [ ] Atomic tenant/global spend reservation and embedding accounting.
- [ ] Tenant job quotas, cancellation, retries, fair scheduling.
- [ ] Redirect origin handling, persistent crawl checkpoints and coverage.
- [ ] Coverage-aware delayed verification and historical evidence review.
- [ ] Evidence retention, completed-audit selection, persistent finding lifecycle.

## Performance and operations

- [ ] Containerized web/API/persistent worker and Caddy deployment.
- [ ] Bounded parallel audit stages and independent dashboard rendering.
- [ ] Correlated timing, readiness, worker heartbeat and alerts.
- [ ] Database query profiles and performance targets under load.
- [x] Restore drill: weekly against production and on every CI run (#201).
- [x] Retention decided in ADR-0026: Neon's 6-hour restore window plus manual `pre-<change>` branches before destructive changes; off-vendor encrypted backups deferred to a stated migration trigger.
- [ ] Expand/contract migration release workflow and snapshot repair.

## Current product and full roadmap

- [ ] Repository subdirectories and every advertised framework edit strategy.
- [ ] Search Console baseline/follow-up measurement and PR outcome reporting.
- [ ] Integration disconnect, site/account export/deletion, OpenAPI.
- [ ] Topic findings, competitor watch, rank tracking and multi-engine visibility.
- [ ] Content history/duplication, GBP/NAP/geo-grid, GA4/Bing/inspection.
- [ ] Supported accessibility/machine-interface diagnostics.
- [ ] GitLab and Bitbucket adapters with shared contracts.
- [ ] Stripe and Daraja sandbox billing, entitlements, membership roles.
- [ ] Evidence exports, independent 50-page evaluation, recorded-demo preparation.

## Local database

Run `docker compose -f compose.test.yml up -d --wait`.
Set DATABASE_URL to `postgresql://postgres@127.0.0.1:15432/rankwright_test`, TEST_DATABASE=1 and ALLOW_E2E_SEED=1 in the invoking environment.
Then build, migrate this test database, run unit/integration tests, and run browser tests.
The browser configuration does not load the root .env. Never point these commands at production.

## Implemented portions of unfinished gates

- Audit submission and PR-merge transitions write transactional outbox records. Rollback, duplicate event, failed delivery/retry, and tenant isolation tests pass. Failed deliveries now receive persisted exponential backoff and do not block later due events; concurrent publishers are covered by database tests. Other job producers, operator recovery tooling and sustained crash/reorder testing remain open.
- Versioned queues use explicit exclusive policies; concurrent audit enqueue deduplication is tested. Persistent worker and container/Caddy definitions are drafts, not deployment-ready.
- Public HTTP requests connect to validated DNS addresses; reserved-range and redirect tests pass. The crawler's browser now refuses private destinations in code (#190); DNS-rebinding-proof, network-level egress filtering on the worker host remains open.
- Public-check attempts reserve quota atomically before fetching. Trusted reverse-proxy handling is implemented (#196) and set to the measured three hops in production (#199).
- Verification requires positive page/rule coverage and confirmed deployment. Only supported page-level rules currently qualify; full attempts/history persistence and the 24-hour retry schedule remain open.
- In-flight frontier entries are recoverable from serialized state. Persisting checkpoints during production crawls remains open.
- Embedding calls record usage, use fallback providers, and cap parallel SDK requests. Unknown model pricing is refused. SDK retries are disabled; a failed spend-ledger write cannot trigger another paid provider call. Atomic tenant/global reservations now cover model, embedding, SERP, keyword, and backlink calls. Provider price validation and abandoned-call reconciliation remain open.
- Findings use the latest completed audit, and fix branches use persisted finding row IDs. Stable cross-audit finding identity and fix-attempt records remain open.

## Validation record (2026-09-24)

- Complete workspace test command passed against disposable local Postgres after migrations through 0022, before the final dependency update.
- After dependency updates: connector 299, crawler 158, LLM 11, and API 157 tests passed. LLM coverage includes a real SDK transport with fixture HTTP responses, without paid calls.
- Final workspace type checking passed all 31 tasks and lint passed; production build output reports all 18 targets successful. Local standalone packaging is opt-in because Windows symlink privileges differ from Linux; Docker sets NEXT_STANDALONE=1.
- Production advisory registry check: zero critical, high, moderate, or low findings across 364 dependencies. This is a point-in-time dependency check, not proof of application security.
- AI SDK 5 retains explicit Chat Completions selection for compatible providers, uses maxOutputTokens and inputTokens/outputTokens, and has a scoped @ai-sdk/provider-utils@3 Undici 6 override. Its packaged runtime has no Undici import; fixture SDK transport tests pass. Recheck this override on future SDK upgrades.
- Browser suite: 14 passed in 27.1 seconds on a clean rerun with successful teardown. The first sandboxed run passed its assertions but could not terminate its Windows server processes; the verified test servers were cleaned up before the rerun.
- Sustained queue recovery, Linux image build, production-like load benchmark, browser egress controls, backup restoration, and external-provider acceptance remain unvalidated.

## Configuration and rollout notes

GitHub App user authorization requires GH_APP_CLIENT_ID and GH_APP_CLIENT_SECRET and an allowed callback URL matching the API's /connections/github/callback endpoint. Installation authorization is not complete until this callback is configured for the deployed GitHub App.

All integration-test configurations reject non-local or unmarked database URLs. Set both explicit test flags from the local database instructions; no test runner loads the repository's root .env.

No new infrastructure has been purchased or container deployment completed as part of these repairs. Shared-project migrations through 0024 have run successfully. The container deployment drafts must pass their security, recovery, cost, and image-build gates before use; successful CI does not establish live application deployment health.

## Spending reservation implementation

Migration 0023 adds tenant-isolated spend reservations and changes the database default for new tenants to zero paid allowance. Existing tenant allowances are preserved. Apply this additive migration before deploying the dependent application changes.

Set GLOBAL_MONTHLY_BUDGET_MICROS explicitly alongside tenant allowances. Its default of zero disables calls with a positive configured cost. The global limit covers all model and SEO-data spend; it does not include infrastructure charges.

The database serializes reserve and settle transactions with a shared advisory lock. Each reservation considers both committed monthly spend and all unresolved reservations, including older months. Settlement writes usage and closes the reservation in the same transaction. Replaying an identical settlement does not add spend; a different amount for an already settled reservation is rejected. Tenant RLS applies to reservation reads and settlement ownership.

Model input reservations use a conservative UTF-8 size estimate including serialized structured-output schema and framing allowance; output uses the configured token limit. This is an estimate against the configured price table, not a guarantee against vendor price changes or unmodeled billable charges. Unknown prices fail before invocation. A fallback needs its own reservation. Missing usage uses the reserved token estimate rather than zero.

Ambiguous failures and failed ledger writes keep capacity reserved. Reservations never expire into free budget automatically: a vendor may already have charged for the call. An operator can settle a reservation through recordSpend only after reconciling the vendor charge, including an explicit zero for a confirmed unbilled request. Automated reconciliation, an operator UI, validated live tariffs/free-tier eligibility, and budget alerts remain release gates.

Regression coverage includes simultaneous tenant/global exhaustion, duplicate and conflicting settlement, cross-tenant access rejection, abandoned holds across month boundaries, invalid amounts, and model fallback/refusal behavior. Migration 0023 was initially validated locally and subsequently applied to the shared project database before PR #177 merged.

Reservation validation: the full workspace suite passed against local Postgres after migration 0023; final type checking passed all 31 tasks and lint passed. The account API exposes reservedMicros, and the account page deducts pending reservations from available budget. That initial validation was local; shared-project migration execution is recorded in the release entries below. Live application deployment acceptance remains unverified.

## Release and follow-up (2026-09-25)

PR #177 merged as ecc99bb5a560b53cc6240c311870b30946a826b5. The user explicitly authorized changes to the school-project database, whose accounts are test accounts. The branch migration workflow succeeded before merge; the main-branch migration and CI workflows subsequently succeeded. The CI repair forwards explicit fixture flags through Turbo and disables database test caching.

Follow-up branch repair/outbox-retry-isolation adds migration 0024 and persisted per-event retry scheduling. Failed delivery is retried after 5 seconds, doubling to a one-hour ceiling; the event remains pending. Failure codes omit exception text. Later due events can proceed while the failed event waits. Attempt counts survive worker restarts. PR #178 merged on 2026-09-26 as 7836a08c40238dff871b0632d7b7d709d7fb6884. Migration 0024 succeeded against the shared project database before merge and the post-merge migration workflow succeeded again. All 17 database tests passed locally. Post-merge CI passed formatting, lint, type checks, build, workspace tests and all 14 browser tests (run 36194661984).


## Next priorities after PR #178

1. Fix-webhook binding repair #180 is complete in PR #181; matching and state/outbox updates share a locked transaction, and post-merge CI passed.
2. Complete job durability across remaining producers, persisted fix attempts and crawl checkpoints; exercise crash/reorder recovery.
3. Finish browser egress isolation, token/session revocation and trusted-proxy handling.
4. Validate worker/container deployment, readiness and heartbeat reporting, load behavior, and backup restoration.
5. Resume product expansion after these release gates: outcome reporting, integration lifecycle, remaining framework support, analytics and provider adapters, billing, and evaluation/demo evidence.


## GitHub tracking (2026-09-26)

Repair epic #179 records merged PRs #177/#178, migrations, CI evidence and remaining release gates. Issue #180 tracks fix-webhook binding validation. Epic #173 now marks its already-closed public-check and contributor-opportunity stories complete; topic-map completion and competitor watch remain open. Implementation and merge evidence for the webhook follow-up belong on #180 before it is closed.

Webhook binding validation: all 164 API tests passed against disposable local Postgres; audit build, API/worker type checks and lint passed. Full CI and merge evidence are tracked on #180.


## Durable fix requests (#182)

Fix submission now persists an outbox request and clears the previous error in one tenant transaction. A failure to write the request rolls back the error reset. Immediate queue failure leaves the durable request accepted for a later worker. The worker publisher supports fix events, and immediate delivery and replay share a UUID request ID. pg-boss rejects replay of a retained completed job ID; a new explicit request gets a new ID. This deduplication lasts only while the queue record is retained. Findings no longer open are skipped before provider or model work.

Recovery coverage terminates only the dedicated test publisher's Postgres connection after delivery and before acknowledgement. The event remains pending and a new publisher delivers it again, establishing at-least-once delivery, not exactly-once external side effects. A separate queue test covers replay after completion. Site verification requests, sustained process/load recovery, persisted fix attempts and provider-side reconciliation remain open. No schema migration is required for this change.

Local validation for #182: 18 database tests, 7 queue tests and 169 API tests passed; queue build, affected package type checks and lint passed. CI and merge evidence are recorded on the issue.

## Durable verification requests (#184)

Fix requests #182 merged in PR #183; post-merge CI and migration passed. Site verification was the last on-demand producer that called the queue directly. It now locks the site, requires status `none`, and writes a `verify` outbox event in the same tenant transaction before trying immediate enqueue. A queue outage returns 202 with the request pending in the outbox. Immediate delivery and replay share a UUID request ID, and the per-site singleton key is kept. The worker returns before any Google or GitHub call when the site is already `pr_open`, `merged` or `verified`.

Scheduled AI polls and pending confirmations are rebuilt from database state on every sweep, so they recover without an outbox. With this change every on-demand producer goes through the outbox. Sustained process/load recovery, persisted fix attempts and provider-side reconciliation remain open.

Local validation for #184: 174 API tests and 7 queue tests passed against the local test Postgres; affected package type checks and lint passed. No schema migration.


## Independent handoff review (#186)

Verified merged PRs #183 (48378ab) and #185 (3200ccd) against their code and successful post-merge workflows, not only the handoff transcript. #183's migration workflow also passed; #185 required no schema change. No blocking defect was found in #185's durable verification path during this review.

Added direct verification-queue regressions for concurrent delivery of the same request ID, replay after completion, a new explicit request ID, and pending work surviving queue connection restart. All 9 queue tests passed against disposable local Postgres; queue build, type checks and lint passed. This does not establish recovery from a killed worker during remote side effects or sustained load. The retained-record limit on queue deduplication remains.

Corrected #185's rollback instructions: preserve `verify` publication support until accepted events drain; do not delete pending requests. Full CI and merge evidence for this follow-up are tracked on #186, under #179.

## Fix PR adoption after a crash (#188)

A fix job that dies after GitHub opens the PR but before the finding is marked `pr_open` is redelivered by the outbox. The worker now looks up an open PR on the finding's `seo-agent/<rowId>-` branch before it reads the repo or calls a fixer or model, and adopts it if found. A crash in that window therefore costs neither a second model call nor a second PR. Recording a PR is guarded to move only `open` findings, so a merge a webhook has already recorded is not overwritten.

Still open: a PR closed or merged before the retry is left to the webhook and polling sweep, and the head-prefix lookup reads only the first 100 open PRs. Local validation: 175 API tests passed; worker and API type checks and lint passed. No schema migration.


## Crawler browser egress guard (#190)

The crawler rendered customer pages in Chromium with no request interception, so a crawled page could make our worker request loopback, the cloud metadata service or private networks through images, iframes, scripted fetches, WebSockets or redirects, and the answer could land in stored rendered HTML. The range check now lives once in `@seo/core` (`isPrivateAddress`), shared with the SSRF-guarded HTTP client.

The crawler routes every browser request and WebSocket through an egress guard that resolves each host (cached per crawl) and refuses any that resolves to a private address. Playwright does not route redirect hops, which the first test run exposed: a page redirecting to an internal host still reached it. The route handler therefore fetches each request without following redirects, vets the Location and fulfils the response, so every hop is routed. Service workers are blocked, WebRTC is restricted to proxied UDP, robots.txt, llms.txt and sitemap fetches follow redirects by hand with each hop checked, and a refused frontier URL becomes a skip with its reason. A private seed fails the audit with the egress reason and is never scored.

Evidence: a hostile fixture reaches an internal host by image, iframe, fetch, redirect, sitemap redirect and llms.txt redirect when unguarded (the control), and with the guard none of those paths reach the server, which records every request as the witness; the WebSocket is refused by the guard's own route. Chromium's Local Network Access check also blocks that socket once pages are fulfilled, but the guard does not rely on it. Local: 181 crawler tests (three consecutive runs), 77 audit, 299 connectors and 55 core tests passed; workspace type checks and lint passed.

Residual: Chromium and the route handler each resolve names independently of our check, so a hostile DNS server can still rebind between check and connect. The complete control is network-level egress filtering on the worker host, which remains open with the container deployment work.


## Token expiry and revocation (#192)

Migration 0025 adds `kind` (`session` or `token`) and `expires_at` to `api_tokens`, and backfills existing browser sessions to `session` with an expiry thirty days after issue. The auth check refuses any row past `expires_at` instead of recognising sessions by display name, so a hand-minted token that happens to be called "Browser session" is no longer treated as one. New sessions are minted with their kind and expiry, and the session prune keys on `kind`. `mint-token` accepts an optional expiry in days; the default stays unexpiring so existing automation is unaffected.

New protected routes: `GET /auth/tokens` lists live credentials (name, kind, dates, which one is current; never a hash), `DELETE /auth/tokens/:id` revokes one, and `POST /auth/tokens/revoke-others` signs out everywhere except the caller. All run under tenant row-level security; another tenant's id is a 404.

Local validation: the backfill was checked against pre-migration rows in the local test database (a 10-day-old session gained a 30-day expiry; a 400-day-old CLI token stayed unexpiring). 183 API and 18 database tests passed; workspace type checks and lint passed. The settings page for these routes is a follow-up.


## Sessions and tokens settings page (#194)

Settings > Account now lists every live session and token (name, kind, created, last used, expiry, and which one this browser is using) with a revoke button on each and a "sign out everywhere else" action. Revoking the current credential clears the cookie and returns to login. The API client gained `listCredentials`, `revokeCredential` and `revokeOtherCredentials`, and now resolves a 204 without parsing a body; before this, every sign-out threw inside the client and the caller's deliberate catch hid it.

Local validation: 5 API-client tests (one new, for the 204 path) and all 15 browser tests (one new, for the credentials section against the seeded tenant) passed against the real API and a production web build; type checks and lint passed. The browser test does not click revoke, because the seeded token is shared by parallel specs; the routes behind the buttons are covered by the API integration tests from #192.


## Trusted reverse-proxy handling (#196)

The anonymous check keys its per-address quota on `request.ip`, and the API trusted no proxy, so behind Render every visitor was counted as the proxy's address and shared one five-per-day allowance. `TRUSTED_PROXY_HOPS` (default 0) now selects the client address that many hops back along X-Forwarded-For from the right, where our own proxies append and a client cannot reach. Fastify 5.12 deliberately ignores a bare numeric `trustProxy` because a hop count cannot validate the immediate peer; our first test run caught that the setting was silently ignored. `trustedProxy` therefore trusts the first hop only when the peer is on a private network, then reads the configured number of hops. Invalid values stop the process at startup.

Evidence: API integration tests drive the real quota with a limit of one. A spoofed prefix does not buy a second check, two clients behind one private hop get separate quotas, a public peer's header is ignored, zero hops ignores the header, and out-of-range values refuse to start; unit tests cover the trust decision. Local: 203 API tests passed; workspace type checks, lint and format passed.

Not yet enabled: Render's forum disagrees on whether it overwrites or appends to client-supplied X-Forwarded-For, and how many entries its edge adds. Production stays at zero, the previous behaviour, until the chain is measured on the live service. Setting the count one too high would let clients choose their own address, so it must not be guessed.


## Measured proxy chain and TRUSTED_PROXY_HOPS=3 (#199)

A temporary, env-gated route (#198) echoed the forwarding headers of our own requests to the live service. Every request reaches the process from a local proxy on `127.0.0.1`, so before this change every anonymous visitor was counted as the same address and shared a single five-per-day allowance worldwide. X-Forwarded-For arrived as `[client-written entries], real client, Cloudflare edge (172.x), Render load balancer (10.x)`: with a spoofed `1.2.3.4, 5.6.7.8` header, both values survived on the left, confirming Render appends rather than overwrites. The real client is exactly three hops back from our side, beyond the reach of anything a client writes, and matched the measuring machine's public address.

`TRUSTED_PROXY_HOPS=3` is set in `render.yaml` and the diagnostic route is removed. A regression test replays the recorded production chain, spoofed prefix included, and resolves the real client. Local: 204 API tests passed; type checks and lint passed.


## Backup restore drill (#201)

`scripts/restore-drill.sh` dumps a database inside one read-only, repeatable-read snapshot (through Neon's direct endpoint, because the pooler cannot hold an exported snapshot), restores it into an empty Postgres with `pg_restore --exit-on-error`, and compares a fingerprint taken from the source inside that same snapshot against the restored copy: every table's row count, every column's type, nullability and default, row-level security flags, every policy (roles and a hash of its expressions) and every grant to `seo_app`. Roles are cluster objects, so the target gets login-less shells for them first. The log prints names and verdicts only; the dump never leaves the runner.

It runs weekly against production (`.github/workflows/restore-drill.yml`, Mondays 04:17 UTC, also on demand) and on every CI run against the freshly populated test database, so a schema change that cannot round-trip fails its own PR.

Local evidence: against the local test database the drill passed (17 tables, 145 columns, 14 policies, 16 RLS flags, 56 grants; dump and restore about 3 seconds each). Deleting one tenant row and dropping one policy in the restored copy made it fail with exit 1, naming the dropped policy and the three tables whose counts changed (the tenant delete cascades), without printing any values.

What this does not provide: retention. Neon's Free plan keeps a 6-hour history window, so data damage noticed later than that cannot be undone from Neon, and the drill deliberately discards its dump. Retained, encrypted, off-vendor backups remain open.

Emergency restore from a dump: create an empty Postgres, create the `seo_app` role (`create role seo_app nologin`), then `pg_restore --no-owner --exit-on-error --dbname <new-url> <dump>`, and point `DATABASE_URL` at it (ADR-0007: nothing else names the host).


## Retention policy (ADR-0026)

Decided to accept Neon Free's six-hour restore window as the only retained recovery point, with no off-vendor copies, rather than keeping encrypted dumps as public-repository artifacts. Damage noticed within six hours is restored with Neon instant restore; later damage to re-derivable data is rebuilt by re-running audits, and lost poll history or ledger rows are recorded as loss. Every destructive migration or bulk data fix first creates a Neon branch named `pre-<change>` (branches outlive the history window, are free within the Free plan's ten, and are deleted once verified). The weekly restore drill stays as proof that the data can be restored on any Postgres. Retained encrypted backups in R2 become required at the first non-demo tenant, the first paying tenant, or when customers rely on visibility history.
