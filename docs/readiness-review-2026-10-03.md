# RankWright readiness review — 3 October 2026

Reviewed commit: `a452b392c267d551e34f37c35454583c04af260b` (PR #260).

## Verdict

The project is on the right trajectory and contains substantial working software. Claude's changes improve reliability, evidence, onboarding, and research features. However, the broad promise — find a problem, ship a suitable fix, confirm deployment, and demonstrate the result — is not yet fulfilled consistently across the fixes the UI offers.

Suitable next stage: a supervised demonstration or tightly scoped pilot on explicitly supported repositories, after a fresh end-to-end rehearsal. Not ready for an unrestricted customer launch. Do not interpret a green build or workflow as proof that every customer job succeeded.

## What was checked

- Git history, current implementation, open tracking issues, and recent CI/worker/restore runs.
- Local production build: all 18 build tasks passed.
- Latest CI at the reviewed commit: successful, run `36302796557`.
- Restore drill: successful run `36412804140` on 28 September, following an earlier successful drill on 26 September.
- Isolated local PostgreSQL migrated and seeded; production-built API and web app exercised with Playwright.
- Ten desktop routes rendered: landing, dashboard, findings, finding detail, outcomes, connections, account, visibility, keywords, authority. Four mobile routes rendered at 390px: dashboard, findings, outcomes, connections. No page-level horizontal overflow in these samples. Desktop dark dashboard also captured. This was a focused browser check, not a full accessibility or device certification.
- Read-only aggregate inspection of the shared application database: 14 completed audits, one failed audit, 687 open findings, one verified finding, no pending outbox entries, one recorded PR-opened attempt. No populated baseline or verification records for the newer outcome representation. The existing verified finding therefore does not prove the new outcome implementation has completed its lifecycle.

Local screenshots and browser summary are in `artifacts/ui-review/`. No live paid research, repository-changing fix, merge, or production deployment was triggered by this review. External OAuth and the entire real GitHub/deployment lifecycle were not repeated. A public-page browser timeout from this workstation is not sufficient evidence of a production outage.

## Changes that materially improved the product

The reviewed history includes durable fix requests and verification work, webhook/repository binding, replay tests, adoption of existing open pull requests after some crashes, abandoned-audit cleanup, worker dispatch diagnostics, browser egress checks, expiring/revocable sessions and tokens, spend/pricing corrections, backup restore exercises, and an explicit retention decision.

User-facing additions include setup guidance, clearer research pages, AI question suggestions, country selection for keywords, separate backlinks and mentions, outcomes, before/after evidence, attempted-fix history, delayed Search Console comparisons, merge/revert metrics, self-hosted fonts, and crawl fixes for redirects and SPAs. These are real improvements; they should be retained.

## Priority findings

### 1. Verification does not cover most offered fixes — launch blocker

`packages/audit/src/run.ts:578` reports evaluated verification rules as TECH-005, TECH-006, and TECH-015 through TECH-021. Compare this with the ten deterministic fixers in `packages/fixers/src/registry.ts` plus the TECH-021 model-assisted fix.

Only three of eleven fix-capable rule types overlap the verification coverage: TECH-005, TECH-015, TECH-021. The other eight include canonical tags, crawler access, sitemap changes, local markup/profile links, llms.txt, and SPA rewrites.

`packages/audit/src/verify-fixes.ts` correctly refuses to infer success without rule coverage, URL coverage, and deployment evidence. As a result, the unsupported combinations remain inconclusive even if the code change worked. This is a missing verification capability, not a reason to remove the evidence guard.

Additionally, verify jobs have three retries (`packages/queue/src/index.ts:218`), and the current drain does not provide a general recurring reconciliation of all still-merged findings. A delayed deployment or exhausted inconclusive check can leave the user waiting indefinitely. Deployment recognition currently requires a successful production GitHub deployment for the exact merge SHA with a matching site origin (`packages/vcs/src/github/client.ts:120`). Later-commit deployments and integrations that do not report that evidence need an explicit supported path or a clear limitation.

Acceptance: a rule-by-rule capability matrix; fresh evidence appropriate to each supported rule; passing and failing fixtures; durable rechecks for delayed deployments; a visible actionable inconclusive state. Never verify merely because a rule did not run.

### 2. Fix history is useful, but not a durable execution state machine

`apps/worker/src/fix.ts:42` executes the fix before writing its attempt record; recording failures are caught and logged. The PR status/baseline update and attempt insertion are separate. A crash between these steps can leave a proposed fix without its history, and a subsequent job may skip it because its status already changed.

Open-PR adoption reduces duplicate side effects but does not close every crash window. If a PR merges or closes before its URL is persisted, adoption restricted to open PRs and reconciliation restricted to known PR URLs can miss it.

Acceptance: persist an attempt identity and intent before external effects; use a stable idempotency identity; reconcile open and terminal PR states; exercise crash boundaries around PR creation and database writes. Show genuine in-progress/retry/failure states.

### 3. Capability labels and marketing exceed demonstrated support

The homepage illustrates a PERF-003 LCP image-priority fix, but that fixer is not registered. It also says “whole search surface” and “Proven in Search Console,” although crawl scope is bounded, several axes require optional providers, and technical verification and traffic correlation are different measurements (`apps/web/app/page.tsx`).

Framework detection is broader than the editing strategies. Head insertion relies on a short list of root-relative candidates containing a literal closing head tag (`packages/fixers/src/head/inject.ts:40`). Recognizing a framework does not establish that a common metadata-based layout or monorepo can safely be edited. “Agent can fix” / “We can write it” can appear before repository compatibility is known.

Acceptance: preflight the actual repository, distinguish a supported rule from a supported edit on this repository, expose unsupported layouts clearly, and use a real supported fix in marketing. State which measurements require connections and paid data.

### 4. Site context can silently change during navigation

`apps/web/components/sidebar.tsx:90` preserves the selected site for navigation except Dashboard. The dashboard chooses a default site when no site ID is present. Moving from a selected site to Dashboard can therefore display a different site's results.

Finding links also omit site context (`apps/web/app/(app)/findings/page.tsx:168` and `:197`). The sidebar derives context from the query string, so subsequent navigation can lose it. The rendered default dashboard shows one site's data while its selector says “All sites.”

Acceptance: one persistent definition of active site, consistent links and breadcrumbs, and a two-site browser test proving context survives dashboard → finding → outcomes/research navigation. Make an actual all-sites view distinct from a single-site view.

### 5. Traffic measurement needs fairness and completeness safeguards

`apps/worker/src/traffic-outcomes.ts` takes the first 20 ready records before checking whether they have a usable connection, with no retry scheduling or cursor. Repeatedly unmeasurable records can consume the same batch and starve later ones.

`packages/audit/src/traffic-outcome.ts:96` requests 25,000 page rows without pagination or filtering the request to the affected URLs. On larger properties, omitted affected pages can be interpreted as zero traffic. Baseline age/provenance also needs explicit treatment: an old audit observation is not necessarily a fresh pre-change measurement, and reconstructed legacy baselines must not appear equivalent to captured ones.

Acceptance: fair retry selection, explicit unmeasurable reasons, complete affected-page retrieval, and trustworthy timestamps. Preserve the UI's useful warning that before/after traffic is correlation, not proof of causation.

### 6. Deployment and evaluation proof remain incomplete

The evaluation harness and metrics are useful, but the independent golden dataset is still one four-page case with seven expected findings, rather than the planned broader sample. Browser tests cover seeded app behavior, not the full real OAuth → crawl → PR → merge → deploy → verification journey.

Recent worker workflows are green, but job failures can be handled and counted without failing the workflow. Use application-level outcomes, queue age, failed attempts, and worker heartbeat for health. The reviewed database does not yet demonstrate the new outcome cycle.

Browser DNS checking is useful defense, but checking DNS before the browser resolves a hostname, with cached verdicts, does not replace network-level egress isolation for arbitrary untrusted sites. The accepted demo retention policy and successful restore drills are good progress; revisit the documented retention trigger before onboarding non-demo customers.

Acceptance: complete one fresh real lifecycle on a supported repository, repeat meaningful failure cases, broaden independent evaluation, and document deployment prerequisites and operational recovery. Do not spend the next sprint primarily adding research features.

## UI/UX assessment

The editorial typography, warm palette, spacing, and dark theme provide a coherent identity. Finding evidence and falsification conditions are unusually useful. The connections page and explicit unmeasured states are clearer than pretending unavailable data is a score of zero. Keep this direction.

The design is not yet in its best usable shape:

- Setup occupies almost the first mobile screen and continues substantially below it before results. A five-item checklist gives optional research/local integrations similar visual importance to the core audit/fix prerequisites. Lead with the next useful action and show optional setup progressively.
- Mobile findings use a wide horizontally scrollable table: screenshots show the finding title cut at the right edge and key columns offscreen. No document overflow does not mean the information is easy to use. Prefer mobile finding cards or a deliberately reduced column view with the full title and primary action visible.
- The mobile site table wraps the domain into awkward fragments. Use stacked site rows.
- Secondary text looks faint in both themes. Measure contrast and verify focus, keyboard operation, menu behavior, error announcements, and touch targets before accessibility sign-off. The screenshots alone cannot establish WCAG compliance.
- Queued audits are labeled “Crawling” by `apps/web/components/live-progress.tsx:68`. Separate waiting for a worker from active crawling, show wait age, and provide a useful recovery state when work stalls.
- Authority's empty state tells an end user to add provider credentials to deployment settings. Separate operator configuration from actions the signed-in customer can perform.
- Findings should explain repository compatibility before promising a fix, and outcomes need visible delayed/inconclusive states instead of an indefinite “checking.”

The manual screenshot harness predates the current login and dashboard. A separate screenshot config already exists, but the harness comment points to the wrong command. Repair and document that existing visual-review path; add representative populated, empty, delayed, error, mobile, and multi-site states.

## Recommended next sequence

1. Close verification coverage and recheck scheduling; align the capability matrix and UI promises.
2. Complete and record a fresh supported-site lifecycle through deployment and verified/rejected evidence, including a delayed deployment and an intentionally unsuccessful fix.
3. Close fix-attempt crash windows and traffic-measurement gaps.
4. Fix site context, waiting states, mobile findings, setup ordering, and measured accessibility issues.
5. Broaden independent evaluation and operational proof before expanding launch scope.

Keyword/topic/competitor features and billing can follow the core delivery gate. Their presence cannot compensate for a fix whose result the product cannot reliably determine.

## Tracking

Existing issues #179 (repair), #212 (hands-on product feedback), and #129 (evaluation) remain relevant. Some checklist text is stale or contradictory: #179 retains unchecked groups alongside completed subitems, and #169 contains earlier claims about missing topic wiring that no longer describe the current implementation. Track verified behavior and remaining acceptance criteria rather than treating merged PR counts as readiness.

This review changes no application behavior. The findings above are an assessment and proposed completion criteria, not a claim that the gaps have been repaired.
