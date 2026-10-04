# ADR-0028: Hosting credentials belong to the site, not to the operator

Status: accepted, 2026-10-04. Narrows ADR-0027's "provider-specific current-assignment integrations": they are now configured per site, never per deployment of this product.

## Context

A merged fix is marked verified only when there is evidence that the site's domain serves a commit containing it (ADR-0027). For a Vercel custom domain, GitHub's deployment status is not enough, so the worker reads the domain's current alias assignment from the Vercel API.

That first worked through one `VERCEL_TOKEN` in the worker's environment. It passed live acceptance on the operator's own site (issue #265) and on no other: an operator token can only see the operator's projects, so every other customer's merged fix would have waited for deployment evidence forever. The alternative, giving that one token access to customers' projects, would have made a single credential the key to every customer's hosting account, and would have let one tenant's verification run with another's access.

## Decision

A hosting connection is a row in `hosting_connections`, keyed by site and scoped by tenant with forced row-level security, like every other tenant table.

- The customer supplies a Vercel access token, the project ID, and a team ID when needed, for one site.
- The API validates before it stores: the project must currently serve that site's domain from a ready production deployment built from the site's connected GitHub repository. The site URL and repository come from our record, never from the request. A project that fails the check is refused with nothing stored.
- The token is stored as AES-256-GCM ciphertext of `{ tenantId, siteId, token }` under `TOKEN_ENCRYPTION_KEY`. A row copied to another site decrypts to a binding that does not match, and the worker refuses it.
- The API never returns the token. Status returns the project ID, team ID, when it was validated, and whether it needs reconnecting.
- The worker loads only the connection for the site it is verifying, and the lookup confirms only a domain served by the project that site named. There is no environment fallback: `VERCEL_TOKEN` and `VERCEL_TEAM_ID` are removed from the worker.
- The connection records the origin and repository it was validated against. If either changes, the worker refuses it until it is validated again, and says so on the finding.
- Each replacement gets a new revision. A verification re-reads the site and the revision under a row lock before saving, so a connection replaced or removed during the re-crawl cannot produce a verified result.
- A site with no connection uses GitHub deployment reports alone, which is also the path for every host other than Vercel (see `docs/hosting-independent-deployments.md`). That path stores no credential at all.

## Why a pasted token rather than OAuth

CLAUDE.md rule 5 forbids asking for a Google password and requires OAuth for Google. This is neither: it is a revocable API access token for a hosting provider, scoped by the customer in Vercel. The OAuth equivalent is a Vercel Marketplace integration, which needs a listed integration, a review, and a public callback that is always reachable; the API runs on an instance that sleeps (ADR-0006). A token the customer creates, that we validate, encrypt, bind to one site and can be told to delete, is the smallest thing that removes the shared credential. The integration can replace the form later without changing the table or the worker.

## Consequences

- The operator's own site loses verification until its project is connected through the same form as any other customer. That is intended: there is no privileged path.
- A rotated `TOKEN_ENCRYPTION_KEY` makes stored connections unreadable. The worker reports that as "reconnect the hosting project" rather than failing with a decryption error.
- The access token is as broad as the customer made it in Vercel. We make read requests only, to two endpoints, but cannot narrow the token ourselves. The form says to create it for the owning account or team, and that it can be revoked in Vercel at any time.
- Validation needs a completed production deployment, so a brand-new project cannot be connected until it has deployed once.

## Evidence

`apps/api/test/hosting.integration.test.ts`: refusal with nothing stored, repository-first ordering, encrypted and bound storage, the token never returned, 404 on every verb for another tenant, the worker blind to another tenant's row, refusal of a changed repository and of a copied or undecryptable credential, and a disconnect during the re-crawl saving nothing. `packages/vcs/test/vercel-deployment.test.ts`: a domain served by a different project than the one named is not confirmed.
