# ADR-0002: GitHub App over personal access token

**Status:** Accepted
**Date:** 2026-07-12

## Context
The agent needs write access to a client's repository in order to open pull requests. We can obtain this with a personal access token that the client generates, or by publishing a GitHub App the client installs.

Handing a third party a PAT is a security anti-pattern. PATs are long-lived, often broadly scoped, tied to a human rather than to the integration, and invisible in an org's audit trail.

## Decision
Ship a **GitHub App**. Request the minimum permissions: `contents: write`, `pull_requests: write`, `metadata: read`, `checks: read`. Use installation access tokens, which are short-lived and per-repository.

Abstract all of it behind a `VersionControlProvider` interface so GitLab and Bitbucket can be added without touching the fixer logic.

## Consequences

### Good
- Least privilege, per repository.
- Tokens expire automatically.
- The installation appears in the org's audit log, so a client can see exactly what we can touch and revoke it in one click.
- Works for organisations, not just individual accounts.
- Selling to a security-conscious client becomes possible.

### Bad
- More setup: app registration, webhook endpoint, JWT signing, installation token exchange.
- The client has to install an app rather than paste a token, which is one more onboarding step.

## Alternatives considered

### Personal access token
Rejected. Long-lived, over-scoped, tied to a human, no audit trail. No serious client would grant it.

### OAuth App
Rejected. Acts as the user, inherits all of the user's repo access, which is far broader than we need.

### Deploy keys
Rejected. Cannot open pull requests.
