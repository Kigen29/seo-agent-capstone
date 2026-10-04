# Readiness completion, 3 October 2026

This implements the code repairs identified in [the readiness review](readiness-review-2026-10-03.md). That review describes the earlier commit, not the behavior after this change. Implementation and local acceptance do not establish production acceptance.

## Verification contract

All eleven currently offered fix types now have positive checks. A confirmed production deployment is required before observations can decide an outcome.

| Rule | Evidence required after deployment |
| --- | --- |
| TECH-002 | Successfully observed robots.txt, with the crawler block no longer present |
| TECH-003 | Successfully observed robots.txt declaring a sitemap |
| TECH-004 | Completely fetched/parsed sitemap tree; offending entries removed or now healthy |
| TECH-005 | Affected page responds successfully and is no longer noindex |
| TECH-007 | Declaring page retains a canonical pointing to an observed healthy, indexable target |
| TECH-015 | Successfully observed affected pages contain no insecure HTTP resources |
| TECH-021 | Successfully observed affected pages have a non-empty description |
| TECH-022 | Every affected route responds successfully without a redirect |
| LOCAL-001 | Affected page contains LocalBusiness markup |
| LOCAL-002 | Business markup links both hasMap and sameAs to the configured profile |
| AGENT-001 | Successfully observed, non-empty llms.txt |

Missing, blocked, truncated, or failed observations remain inconclusive. A removed sitemap entry does not require its old 404 to become a working page. A canonical target that was intentionally replaced does not require the old redirect to be repaired. Removing a diagnostic precondition is not sufficient proof of success.

Affected URLs are prioritized within the existing crawl cap. Canonical targets join the frontier. Root-resource observations distinguish genuine absence from failed fetching. Pending merged findings are rebuilt into queue jobs hourly when workers run, even after previous jobs exhaust retries. This is not an hourly uptime guarantee for a scheduled free-tier worker.

GitHub deployment evidence must be production, successful, and associated with the site's exact origin. The latest successful matching deployment may be the merge commit or a descendant. A rollback, diverged commit, or unreadable comparison does not fall back to an older deployment as proof. The optional Vercel lookup added during live acceptance can instead confirm the current custom-domain assignment and source commit through the hosting API; see [deployment-evidence.md](deployment-evidence.md). Other integrations without authoritative origin and commit evidence remain inconclusive; the UI explains why verification is waiting.

## Recovery and measurements

Migration **0028** adds verification/traffic check timestamps and supports running attempts with no completion timestamp. Fix intent is persisted before repository work. PR state, baseline, and successful attempt completion are committed together. Interrupted running attempts can be resumed, and request-specific branch identities let retries recover PRs that already merged or closed. PR lookup is paginated and refuses to create another PR if its bounded lookup cannot establish absence.

Traffic comparisons paginate Search Console results and refuse a result that exceeds the measurement cap. Attempt ordering rotates unmeasurable records behind untried ones. Missing historical baselines do not become fabricated before measurements, and original observation timestamps are retained. Technical verification is separate from traffic correlation; it does not establish that a fix caused a ranking or revenue change.

Browser HTTP and HTTPS traffic now uses a crawl-scoped proxy that validates DNS answers and connects to the checked IP. Chromium, route fetches, and root-file requests share this path. Existing request guards remain. QUIC and non-proxied WebRTC are disabled. This addresses DNS rebinding at the transport boundary; host/container isolation remains useful defense against browser compromise.

## Product changes

- Site selection survives dashboard, finding, bookmarked audit, and research navigation. A site-specific dashboard no longer presents an All sites selection.
- Mobile findings use readable cards; mobile site summaries stack instead of splitting hostnames across narrow columns.
- Results precede optional setup, which is an expandable section explaining which connections are necessary for which actions.
- Queued work is distinguished from crawling and shows waiting time on the audit page.
- Automatic-fix labels describe availability; repository compatibility is checked before a PR is written. Unsupported source layouts remain a reported limitation, not a promised universal edit.
- Missing attempt history is reported as unavailable, rather than appearing as no attempts.
- Secondary and unmeasured text contrast is increased; mobile navigation supports Escape and focus return. The setup disclosure stays inline and mobile metadata uses readable separators.
- The landing example uses a supported robots.txt fix. Crawl scope, optional data dependencies, deployment checks, and citation uncertainty are stated.
- The existing screenshot harness now uses the current session flow and documented screenshot command.

## Evidence and boundaries

The new lifecycle integration test uses a real local HTTP site, browser, parser, generated patch, database, and shared PR transition function. GitHub's transport and deployment signal are controlled test seams. It proves delayed deployment remains undecided, database state can reschedule it, an unsuccessful deployment is rejected, and the corrected deployment becomes verified with stored before/after evidence.

Unit and integration regressions cover every offered verification rule, failed/missing resources, traffic beyond the first response, intent before side effects, recovery of an already-merged PR, private-network blocking, DNS pinning, and deployment ancestry/rollback. Browser regressions cover selected-site navigation, mobile finding bounds, keyboard menu operation, and measured secondary-text contrast in both themes. These are focused checks, not a claim of comprehensive accessibility certification.

The following are separate acceptance gates and must not be marked complete merely because this PR merges:

1. Apply migration 0028 before releasing API/worker builds that query its fields. Confirm migration workflow success, deployed commit, and application health.
2. Rehearse a real connected demo repository through user-reviewed merge and production deployment. Record the PR, deployed SHA, fresh verification outcome, and timestamps. The local fixture is not a substitute for external OAuth/installation/hosting acceptance.
3. Retain inconclusive status if the hosting integration cannot supply deployment evidence. Do not manually mark verified to make a demo look complete.
4. Expand independently labeled evaluation beyond the existing four-page dataset. Generated regression fixtures are not independent golden labels. Issue #129 remains open for this reason.
5. Accept paid-provider configuration/rates and actual measurements within existing budgets before advertising those axes as available. A configured key alone is not acceptance evidence.
6. Revisit the accepted backup-retention trigger before the first non-demo/paying tenant. Existing restore drills and the demo retention decision remain credited.

For deployment rollback, prefer a forward fix. Do not drop 0028 or delete running intents. Stop the changed worker before reverting application code; older readers do not understand a running attempt with a null completion time. Resolve or explicitly fail interrupted attempts before serving them through an older version.

Local validation passed 220 API tests (including the real-stack lifecycle), 112 audit tests, 193 crawler tests, and 41 VCS tests. The monorepo build and typecheck passed. Final browser and CI evidence is recorded on PR #261.

Local evidence is saved under ignored `artifacts/readiness-*.log` and screenshots under `apps/web/screens/`. GitHub CI and the PR provide the durable review record. No credentials, private key material, or test database dumps belong in the PR.
