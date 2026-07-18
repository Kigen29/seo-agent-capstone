# Sprint 2 Backlog: Close the Loop

**Sprint goal:** The agent stops advising and starts acting. It connects to a **real client repository**, and for a fixable finding it opens a **pull request that fixes it**, on a branch, with a body a human can trust. A person merges, and the agent **proves the fix held**. No change ever reaches the default branch without a human.

This is the whole thesis of the product, built for the first time: every competitor sends a list, we send a pull request.

**Sprint demo (the money moment):** on a real client repo already connected in Sprint 1,

1. Click **Verify with a PR**. The agent creates the Search Console property, fetches the real verification token, and opens a PR that drops the verification meta tag into that repo's head, in the right place for that repo's framework. Merge it, and verification completes on Google's side. No competitor can do this, because no competitor has the repo.
2. Open a technical finding, click **Fix with a PR**, merge, and watch the verifier re-crawl the affected URL and flip the finding to `verified`.
3. Open a weak-title finding, click **Fix with a PR**, and show that the fix text came from exactly **one** `smart` LLM call, schema-validated, with old and new side by side in the PR.

---

## What already exists (do not rebuild)

- **OAuth per tenant** with the `siteverification` scope already granted, encrypted refresh tokens, refresh and the GSC client (`packages/connectors/src/google`, `.../gsc`). The killer feature needs only two new Google clients on top of this.
- **The domain model** already carries the write path: `Finding.fixable`, `Finding.status` (`open | pr_open | merged | verified | rejected | wontfix`), `Finding.prUrl`, and `sites.repoFullName` + `sites.framework` in the schema.
- **The framework enum** (`packages/core/src/site.ts`) already lists twelve stacks. Sprint 2 extends it, it does not invent it.
- **The queue** pattern (`packages/queue`): `AUDIT_QUEUE`, `enqueueAudit`, `drainAudits`. The fix queue is the same shape.
- **The API is the only door** (ADR-0009) and **the worker runs on GitHub Actions** (ADR-0006). Fixes generate on the worker; the API only enqueues and receives webhooks.
- **The LLM layer**: `llm.object({ role: 'smart', schema, prompt })` (ADR-0005). The content fixer asks for a role, never a vendor.

---

## Client setup this sprint depends on (flag early, like the Google OAuth step)

- **Register the GitHub App** once, in the developer's GitHub account: permissions `contents: write`, `pull_requests: write`, `metadata: read`, `checks: read` (ADR-0002). Record the App ID, a generated private key, and a webhook secret as secrets in Render and GitHub Actions. Never in the repo.
- **The client's site must be a GitHub repository**, and the client **installs the App** on it. The install is per repository and appears in their audit log; they revoke it in one click.
- Set the webhook URL to the Render API's `/webhooks/github`.

---

## Epic 6: The write path

### STORY-014: The GitHub App and the `VersionControlProvider`
**As** the agent, **I want** a least-privilege, per-repo way to open pull requests, **so that** a client can grant write access without handing over a long-lived token.

**Acceptance criteria**
- Given a fixable finding, when the provider opens a PR, then it is on a branch named `seo-agent/<finding-id>-<slug>`, and **nothing is ever pushed to the default branch directly** (rule 2). The provider has no method that can.
- Given a PR is opened, then its body contains the five required sections: the finding, the evidence, the expected effect, the falsification condition, and a rollback note (rule 4). A PR missing any section is a bug the provider refuses to create.
- Given an installation, when the provider acts, then it uses a **short-lived installation access token** scoped to that one repository, exchanged from the App JWT and cached until just before expiry.

**Tasks**
- `packages/vcs`: a `VersionControlProvider` interface (`getFile`, `putFiles`, `createBranch`, `openPullRequest`, `findOpenPrForFinding`, `getInstallationToken`) and a `GitHubProvider` implementing it over Octokit.
- App JWT signing (RS256 from the private key), installation token exchange with a small in-memory cache.
- PR body builder that takes a `Finding` and refuses to render without all five sections.
- The interface is provider-agnostic so GitLab and Bitbucket slot in later without touching any fixer.

**Falsification:** a commit lands on `main` directly, or a PR body reaches GitHub without a falsification section.

---

### STORY-015: Connect a repository, and receive webhooks safely
**As a** client, **I want** to install the App on my repo and have the agent know about it, **so that** connecting is one click and every event is trustworthy.

**Acceptance criteria**
- Given the connect button, when the client installs the App and selects a repo, then the site row records the installation id and `repoFullName`, and the dashboard shows the repo as connected.
- Given GitHub posts a webhook, then its `X-Hub-Signature-256` HMAC is verified against the webhook secret **before any handling**, and an invalid signature returns 401 and does nothing.
- Given a `pull_request` `closed` event with `merged: true` for one of our branches, then the matching finding moves to `merged` and a verify job is enqueued.

**Tasks**
- API: `POST /connections/github` (start install, redirect to the App install URL), the install callback, and `POST /webhooks/github` (public route, HMAC-verified) handling `installation`, `installation_repositories`, and `pull_request`.
- Map an incoming PR back to its finding by branch name.
- Persist installation id per site; store no tokens (they are minted on demand from the App key).

**Falsification:** a forged webhook body mutates a finding, or the App private key appears anywhere outside the secret stores.

---

## Epic 7: Framework detection and the fixer engine

### STORY-016: Detect the framework from the repo, for every stack
**As a** fixer, **I want** to know what the repo is built with, **so that** "add a meta tag" becomes a diff in the right file rather than a guess.

**Acceptance criteria**
- Given a repo, when detection runs, then it returns the framework from repo signals (dependencies in `package.json`, lockfiles, config files such as `next.config`, `nuxt.config`, `astro.config`, `angular.json`, `vite.config` with the Vue or React plugin, `wp-content`, `Gemfile`, `manage.py`, `_config.yml`), never from the rendered page.
- Given an unrecognised repo, then it resolves to a **universal static-HTML** strategy and never crashes. Unknown is a supported case, not a failure.
- Given detection, then the result is stored on `sites.framework`.

**Tasks**
- `packages/fixers` framework detector reading a handful of files through the provider's `getFile`, no full clone.
- **Extend `frameworkSchema`** with `angular` and `vue_spa`, and add the matching Drizzle enum migration (the DB enum is generated from `frameworkSchema.options`).
- Map every enum value to a head-injection **strategy family**: framework-native head API (`next`, `nuxt`, `astro`, `sveltekit`, `remix`, `gatsby`), SPA entry HTML (`react_spa`, `vue_spa`, `angular`), template hook (`wordpress`), static-generator layout (`hugo`, `jekyll`), server template (`django`, `rails`), and the universal `index.html`/root-document fallback.

**Falsification:** a Next.js repo is detected as unknown, so the wrong fixer runs.

---

### STORY-017: The fixer engine and registry
**As** the agent, **I want** one place that turns a finding into a minimal diff, **so that** fixers are pluggable and never duplicate a PR.

**Acceptance criteria**
- Given a fixable finding, when the engine runs, then it selects the fixer registered for the finding's `ruleId`, dispatches on the detected framework, and returns a **minimal** set of file changes.
- Given a finding that already has an open PR, then the engine does not open a second one (idempotency on finding id).
- Given the programmatic-page guardrail, then a fixer that would create location pages warns at 30 and hard-stops at 50 (rule 7).

**Tasks**
- `Fixer` interface: `canFix(finding)` and `generate(finding, repoCtx): FileChange[]`.
- A registry mapping `ruleId` to fixer, and a framework-strategy lookup shared by the head-injection fixers.
- Deterministic-first: fixers edit through structured transforms (parse the head, insert a tag) rather than blind string replace wherever a parser exists (ADR-0011, to be written).

---

## Epic 8: The killer feature, Search Console auto-verification

### STORY-018: Search Console `sites.add` and the Site Verification client
**As** the agent, **I want** to create a property and fetch its verification token, **so that** the repo can prove ownership.

**Acceptance criteria**
- Given a connected Google account, when we add the property, then `sites.add` runs under the tenant's own OAuth grant, never a service account (ADR-0003).
- Given a property, when we request a token, then the Site Verification API `webResource.getToken` returns the **real** meta tag token, and we store the property as `sc-domain:` or URL-prefix form on the site.
- Given a verification attempt, when we call `webResource.insert`, then we report verified **only** on a success response, never optimistically.

**Tasks**
- `packages/connectors/src/gsc`: `sites.add`, and a new `siteverification` client (`getToken` meta method, `insert`), reusing the existing OAuth refresh path.

**Falsification:** we display "verified" when `webResource.insert` did not succeed.

---

### STORY-019: The auto-verification vertical (the demo)
**As a** client, **I want** to verify Search Console by merging a PR, **so that** I never touch DNS or upload a file by hand.

**Acceptance criteria**
- Given a connected repo and Google account, when the client clicks **Verify with a PR**, then the agent creates the property, fetches the token, and opens a PR that inserts exactly that meta tag into the site's head for its framework.
- Given the PR is merged, then the webhook triggers `webResource.insert`, verification completes, and the site shows verified with the account that owns the grant.
- Given the meta value, then it is the token Google returned, never generated or altered.

**Falsification:** the injected tag's content differs from the token Google issued.

---

## Epic 9: The deterministic fixers and the one LLM fixer

### STORY-020: The first deterministic technical fixers
**As a** client, **I want** the safe, obvious fixes opened as PRs, **so that** I see the loop work on more than one finding.

**Acceptance criteria**, one triggering fixture and one clean fixture per fixer:
- `TECH-002` **unblock a blocked AI search crawler**: remove the `Disallow` for `OAI-SearchBot` / `PerplexityBot` in `robots.txt` (or the framework's robots route), and say in the PR what answers this restores.
- `TECH-006` **add a missing canonical** to the affected pages, in the framework's head.
- `TECH-005` **remove an unintentional `noindex`** from the affected pages.
- Each PR states its own falsification condition, which the verifier will later check.

**Tasks**
- Head-injection and robots fixers built on the strategy families from STORY-016, with the universal fallback.

**Falsification:** a fixer edits the wrong file for a framework, or opens a PR whose diff does not resolve the finding.

---

### STORY-021: The LLM content fixer
**As a** client, **I want** weak on-page text rewritten, **so that** the agent fixes content, not just configuration, and I still trust it.

**Acceptance criteria**
- Given a title or meta-description quality finding (detected by a **rule**, never by the LLM, per ADR-0001), when the fixer runs, then it makes **exactly one** `smart` call via `llm.object` with a Zod schema, and the output is schema-validated before it becomes a diff (ADR-0005).
- Given the LLM chain is unavailable, then the finding stays `open` and no broken PR is opened.
- Given the PR, then it shows the old text and the new text plainly.

**Tasks**
- `packages/agent`: a single content-fix skill, one prompt template, `generateObject` only, cost budget of one call per fixable finding.

**Falsification:** the fixer makes an LLM call per page rather than per finding, or emits unvalidated free text.

---

## Epic 10: The loop plumbing

### STORY-022: The fix queue and the worker
**As** the platform, **I want** fixes to run on the worker, **so that** PR generation is durable and off Vercel.

**Acceptance criteria**
- Given a fix is requested, then a `FIX_QUEUE` job is enqueued and a `repository_dispatch` nudges the runner, which builds, then drains the fix queue exactly as it does for audits.
- Given `runFix(findingId)`, then it loads the finding, the site's repo and framework, selects the fixer, generates the diff, opens the PR through the provider, and sets the finding to `pr_open` with its `prUrl`.

**Tasks**
- `packages/queue`: `FIX_QUEUE`, `enqueueFix`, `drainFixes`.
- `apps/worker`: a `runFix` entry alongside the audit drain.

---

### STORY-023: Fix endpoints and finding status
**As a** client, **I want** to trigger a fix and watch its status, **so that** the loop is visible.

**Acceptance criteria**
- Given `POST /findings/:id/fix`, then it enqueues a fix job, scoped to the tenant through `withTenant`, and returns 404 (not 403) for another tenant's finding (ADR-0008, ADR-0009).
- Given a finding, then its status moves `open -> pr_open -> merged -> verified | rejected`, and `prUrl` is surfaced in the API and the typed client (`packages/api-client`).

---

### STORY-024: The web app, Connect Repository and Fix with a PR
**As a** non-engineer, **I want** buttons, **so that** the whole loop is usable without a terminal.

**Acceptance criteria**
- Given the dashboard, then there is a **Connect Repository** flow (install the App) and, on a fixable finding, a **Fix with a PR** button and a **Verify with a PR** button for the killer feature.
- Given a PR exists, then the finding shows its link and live status, and reflects `merged` and `verified` as the webhook and verifier update it.

---

## Epic 11: Prove the fix held

### STORY-025: The verification loop
**As a** client, **I want** the agent to prove a merged fix worked, **so that** a closed PR is not the same as a solved problem.

**Acceptance criteria**
- Given a merged fix, when the verifier runs, then it checks the finding's **falsification condition**: re-crawl the affected URL for a technical fix, or call `webResource.insert` for the verification fix.
- Given the finding no longer fires, then status becomes `verified`; given it still fires, then status becomes `rejected` with the fresh evidence, and the PR is not silently trusted.
- Given a baseline was captured before the fix, then the verifier compares against it.

**Tasks**
- `packages/verifier` (or a worker verify job): capture baseline on `pr_open`, re-measure on `merged`, decide `verified` or `rejected`.

**Falsification:** a finding is marked `verified` while a fresh crawl still triggers the same rule.

---

## Architecture decisions to record this sprint (ADRs)

Write these as they are made, because the graded design document is generated from `docs/adr/`:

- **ADR-0011: Deterministic-first fix generation.** Extends ADR-0001 to the write side: fixers transform structured representations (parse the head, edit robots) rather than blind string replacement, and every fix is a reviewable diff.
- **ADR-0012: Pull-request safety and idempotency.** Branch naming, never-to-`main`, the five required body sections, one PR per finding, human-merge only, the programmatic-page cap.
- **ADR-0013: Framework-strategy pattern for fixers.** How one fixer serves every stack through a strategy family plus a universal fallback.
- **ADR-0014: GitHub App webhook security.** HMAC verification before handling, minting installation tokens on demand, storing no long-lived tokens.

---

## Out of scope for Sprint 2 (do not build these yet)

- AI visibility polling, backlinks, digital PR, local SEO (Sprint 3).
- Billing and M-Pesa (Sprint 3, if time).
- GitLab and Bitbucket providers (the interface lands now, the implementations do not).
- Full-repo clone and multi-file refactors. Sprint 2 fixes read and write individual files through the Contents API; anything needing a working tree waits.
- Fixers for every framework family at equal depth. The head-injection and robots fixers cover the major families plus the universal fallback; deeper per-framework fixers extend the same interface over time. We will say honestly which stacks are proven and which fall back.
