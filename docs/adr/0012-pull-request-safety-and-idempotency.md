# ADR-0012: Pull-request safety and idempotency

**Status:** Accepted
**Date:** 2026-07-19

## Context

The product's promise is that it opens pull requests against a client's repository. That promise is only worth making if a set of guarantees hold every single time, with no exceptions and no reliance on anyone remembering them:

- Nothing is ever pushed to the default branch. CLAUDE.md rule 2 is not a preference, it is the difference between "a tool that proposes changes" and "a tool that changes your site".
- Every pull request carries enough for a human to decide: the finding, the evidence, the expected effect, the falsification condition, and how to roll back (rule 4).
- A retried job, a double-clicked button, or a re-run worker never opens a second pull request for the same finding.
- We mass-produce nothing (rule 7).

A convention that says "remember to only push to a branch" is a convention that will eventually be forgotten by a tired engineer or a confident agent. The guarantees have to be structural.

## Decision

**Make the dangerous operations unrepresentable, and enforce the required ones before any state is created.** The `VersionControlProvider` interface (`packages/vcs`) is the single seam through which every repository write passes.

### Never to the default branch, by shape

The interface has no method that writes to a branch the caller names, and no method that pushes to the default branch. Its GitHub-facing surface can read a file, create a fresh branch, write onto a branch it just created, and open a pull request. That is all. Rule 2 is therefore not something a fixer must remember; it is something a fixer cannot express, because the method does not exist. Every fix branch is `seo-agent/<finding-id>-<slug>`, and a guard additionally refuses to open a pull request whose head branch equals its base, closing the one way a caller could still collapse the distinction.

### Five sections, or no pull request

`openPullRequest` builds the body first, before it creates a branch or a commit. The body builder refuses to render if any of the five required sections is empty. So a finding missing its falsification, or a fixer missing its rollback note, fails closed, with no branch and no commit left behind. Rule 4 is enforced at the moment of least state, not audited after the fact.

### One pull request per finding

Before cutting a branch, the provider asks GitHub whether an open pull request already exists for this finding, matched by the branch prefix `seo-agent/<finding-id>-`. If one is open, it is returned rather than a second being created. Idempotency normally keys on the finding id (which is also the branch). A flow that wants a fresh branch per attempt (so a closed pull request's stale branch never collides) supplies a unique id per attempt and a stable `dedupeKey`; the branch stays unique, the "is one already open?" check keys on the stable prefix. This is how the Search Console verification flow re-attempts cleanly.

### Humans merge, always

The agent opens pull requests and never merges them. Merge is the human's act of consent, and the loop's later stages (mark merged, re-audit, verify) are driven by the merge webhook, not by us closing our own pull request.

### The programmatic-page cap

The fixer engine counts the files a fix would write and refuses above 50, warning above 30. A fix that would create a wall of pages is the doorway-page anti-pattern rule 7 forbids, so the engine stops it at the engine, before it reaches a pull request, whatever the fixer intended.

## Consequences

### Good

- Rule 2 and rule 4 are properties of the build, not of anyone's discipline. You cannot call a method that does not exist, and you cannot open a pull request without the five sections.
- The write path is idempotent, so retries and double clicks are safe by construction rather than by hoping they do not happen.
- A client reviews a normal pull request, on a normal branch, with the evidence and the rollback in the body, and merges it like any other. That is the entire trust model, and it is legible.
- The same provider serves the Search Console verification vertical and the technical fixers, because both are just "open a pull request that fixes a finding".

### Bad

- The interface is deliberately narrow, so a future need to, say, update an existing pull request is a new method and a new ADR, not an ad-hoc call. Accepted: the friction is the point.
- Matching open pull requests by branch prefix is a GitHub API round trip on every fix. Cheap, and worth it for the guarantee.

### Neutral

- The finding id doubles as the branch identity, which is what lets the merge webhook map a merged pull request back to its finding (ADR-0014). One identifier, three jobs.

## Alternatives considered

### A general `commit(branch, files)` method, with discipline to only pass fix branches

Rejected. This is the convention-based version, and it fails the first time someone passes the default branch by mistake or by cleverness. The safety has to be in the shape of the interface, not in the care of its callers.

### Enforce the five body sections in code review, or in a linter

Rejected. A pull request that reaches GitHub missing its falsification has already failed rule 4; catching it afterward is too late. Building the body first, and refusing to render without all five, moves the check to before any commit exists.

### Auto-merge low-risk fixes

Rejected for this sprint. Merge is the human's consent, and the product's honesty ("we send a pull request, you decide") depends on it. Auto-merge behind a client-configured guardrail is a deliberate future decision, not a default, and it would need its own ADR.

### Let each fixer decide its own idempotency

Rejected. Idempotency is a property of the write path, not of any one fixer, so it lives once in `openPullRequest` where every fix passes through, not copied into each fixer where one could get it wrong.
