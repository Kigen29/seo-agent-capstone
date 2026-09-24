# Repair and roadmap implementation

Status is evidence-based: checked items are implemented, not necessarily deployed. No production data or hosting has been changed.

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
- [ ] Full release validation: local database suite passes; browser and load-test gates tracked below.

## Security

- [x] GitHub user OAuth confirms installation access before attachment; connector authorization and API callback tests.
- [ ] Stored PR/repository/installation webhook binding.
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
- [ ] Encrypted backups, restore drill, retention and capacity limits.
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

- Audit submission and PR-merge transitions write transactional outbox records. Rollback, duplicate event, failed delivery/retry, and tenant isolation tests pass. Other job producers and poison-event recovery remain open.
- Versioned queues use explicit exclusive policies; concurrent audit enqueue deduplication is tested. Persistent worker and container/Caddy definitions are drafts, not deployment-ready.
- Public HTTP requests connect to validated DNS addresses; reserved-range and redirect tests pass. Crawler/browser egress isolation remains open.
- Public-check attempts reserve quota atomically before fetching. Trusted reverse-proxy address handling remains open.
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

No infrastructure has been purchased, no deployment has occurred, and no production migrations have run. The deployment drafts must pass their security, recovery, cost, and image-build gates before use.

## Spending reservation implementation

Migration 0023 adds tenant-isolated spend reservations and changes the database default for new tenants to zero paid allowance. Existing tenant allowances are preserved. Apply this additive migration before deploying the dependent application changes.

Set GLOBAL_MONTHLY_BUDGET_MICROS explicitly alongside tenant allowances. Its default of zero disables calls with a positive configured cost. The global limit covers all model and SEO-data spend; it does not include infrastructure charges.

The database serializes reserve and settle transactions with a shared advisory lock. Each reservation considers both committed monthly spend and all unresolved reservations, including older months. Settlement writes usage and closes the reservation in the same transaction. Replaying an identical settlement does not add spend; a different amount for an already settled reservation is rejected. Tenant RLS applies to reservation reads and settlement ownership.

Model input reservations use a conservative UTF-8 size estimate including serialized structured-output schema and framing allowance; output uses the configured token limit. This is an estimate against the configured price table, not a guarantee against vendor price changes or unmodeled billable charges. Unknown prices fail before invocation. A fallback needs its own reservation. Missing usage uses the reserved token estimate rather than zero.

Ambiguous failures and failed ledger writes keep capacity reserved. Reservations never expire into free budget automatically: a vendor may already have charged for the call. An operator can settle a reservation through recordSpend only after reconciling the vendor charge, including an explicit zero for a confirmed unbilled request. Automated reconciliation, an operator UI, validated live tariffs/free-tier eligibility, and budget alerts remain release gates.

Regression coverage includes simultaneous tenant/global exhaustion, duplicate and conflicting settlement, cross-tenant access rejection, abandoned holds across month boundaries, invalid amounts, and model fallback/refusal behavior. Only the disposable local test database has received migration 0023.

Reservation validation: the full workspace suite passed against local Postgres after migration 0023; final type checking passed all 31 tasks and lint passed. The account API exposes reservedMicros, and the account page deducts pending reservations from available budget. No production migration or deployment was performed.
