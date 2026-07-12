# ADR-0003: OAuth per tenant for Google Search Console, not a service account

**Status:** Accepted
**Date:** 2026-07-12

## Context
Search Console can be accessed with a service account or with per-user OAuth. Service accounts are attractive for automated pipelines because they do not expire and need no browser.

However, a service account has no inherent access to any Search Console property. Someone must manually add the service account's email as a user on **every single property**. Skipping this step is documented as the single most common cause of 403 errors on the API. For a multi-tenant SaaS onboarding non-technical clients, this would be a support disaster.

## Decision
Use **OAuth 2.0 with the tenant's own consent**. Scopes: `webmasters` and `siteverification`. Store the refresh token encrypted at rest, scoped to the tenant.

We will never request or store a Google password. This is stated in the onboarding UI.

## Consequences

### Good
- The client clicks one button and it works. No manual property grants.
- The client can revoke us from their Google account at any time.
- Unlocks `sites.add` and the Site Verification API, which enables our differentiating feature: the agent opens a PR that drops the verification meta tag into the repo, then completes verification automatically.

### Bad
- We must handle refresh token rotation, revocation, and re-consent.
- Refresh tokens are sensitive credentials that must be encrypted at rest and never logged.
- The OAuth consent screen needs Google verification before we exceed the unverified user cap.

## Alternatives considered

### Service account
Rejected. Requires manual per-property user grants. Support nightmare, and the leading cause of 403s.

### Asking the client for their Google credentials
Rejected absolutely. Violates Google's terms, would get the OAuth client banned, and is indefensible.
