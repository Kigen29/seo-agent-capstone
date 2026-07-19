# ADR-0014: GitHub App webhook security

**Status:** Accepted
**Date:** 2026-07-19

## Context

The loop only closes because GitHub tells us when a pull request is merged. That notification arrives at `POST /webhooks/github`, a route that must be public: GitHub calls it from its own infrastructure with no bearer token, and it cannot have one, because there is no user session on that request. A public, unauthenticated route that mutates finding and site state is precisely the kind of endpoint an attacker probes first. Anyone on the internet can POST to it.

Two further facts make this sharper. The webhook carries no tenant context, yet it must update rows that belong to specific tenants under row-level security (ADR-0008, ADR-0009). And the App that opens pull requests holds a private key whose leak would grant write access to every installed repository, in a public source repository (ADR-0006) where a committed secret is a catastrophe.

## Decision

**Prove the delivery is genuinely from GitHub before reading a single field of it, mint repository access on demand and store none of it, and keep the App private key out of the repository entirely.**

### Verify the HMAC before any handling

Every delivery is signed by GitHub with `X-Hub-Signature-256`, an HMAC of the exact body bytes under our webhook secret. The handler verifies this signature first, with a constant-time comparison, and returns 401 without touching the payload if it fails. Anyone can POST to a public URL; only GitHub can sign. An unverified delivery is turned away before a single field is read, so a forged body can never mutate a finding.

### Keep the raw bytes, or the signature never matches

GitHub signs the exact bytes it sent. Re-serialising a parsed JSON object does not reproduce them (key order, whitespace, number formatting all differ), so hashing the re-serialised form would fail every time. The webhook route therefore registers its own content-type parser that preserves the raw request body alongside the parsed object, scoped to that route so the rest of the API keeps Fastify's default JSON handling. The HMAC is computed over the preserved raw bytes.

### Mint installation tokens on demand, store none

The App authenticates to GitHub by signing a short-lived JWT (RS256) with its private key, then exchanging that JWT for an installation access token scoped to one repository. Those tokens are short-lived and minted at the moment they are needed, cached only until just before expiry, and never written to the database. A database dump yields no usable repository credential. The site row stores an installation id, which is a reference, not a secret.

### The private key lives only in the secret stores

The App private key is held in GitHub Actions secrets, Render environment variables, and Vercel environment variables, and nowhere in the repository, which is public. `.env` is gitignored and verified before every commit; a key committed by accident is rotated, not merely deleted. The key is provided base64-encoded to survive the environment fields, and normalised to PKCS#8 in memory because Octokit requires that form.

### Map events to tenants without trusting the payload for identity

Because the webhook carries no tenant, it resolves the affected rows itself, under `asOwner` (the same small pre-tenant class as token resolution in ADR-0009). A merged verification pull request is matched by its branch name (`seo-agent/AGENT-VERIFY-<siteId>-`); a merged fix pull request is matched by the pull request URL we stored when we opened it, which is exact where a branch is not, since a rule key is unique only within an audit. The signed HMAC is what makes trusting these fields safe: the body is proven to be GitHub's, not an attacker's.

## Consequences

### Good

- A forged webhook cannot change state. Verification precedes handling, so an unsigned or wrongly signed body is rejected before it is parsed.
- No long-lived repository credential exists at rest. Tokens are minted per repository, per need, and expire on their own.
- The App private key has one home, the secret stores, and the public repository never sees it. Least privilege from ADR-0002 is preserved all the way to the token exchange.
- The webhook drives the whole back half of the loop (merged, then re-audit and verify) on state it can trust.

### Bad

- The raw-body requirement is a sharp edge: a well-meaning refactor that removes the scoped parser silently breaks every signature, because the re-serialised body no longer matches. It is load-bearing and easy to not notice, so it is documented here and at the call site.
- Minting a token per operation is a round trip to GitHub before each repository action. Cached to the edge of expiry, but not free.

### Neutral

- The webhook joins token resolution as an operation that legitimately precedes tenant context and therefore runs under `asOwner`. That class stays small and countable on one hand, which is the invariant ADR-0009 asked for.

## Alternatives considered

### Trust the source IP or a shared secret in the URL

Rejected. IP allow-lists for GitHub's ranges are brittle and rotate; a secret in the URL leaks into logs, proxies, and browser history. The HMAC over the body is the mechanism GitHub provides for exactly this, and it proves the payload, not merely the origin.

### Parse the JSON normally and hash the re-serialised object

Rejected because it does not work: the re-serialised bytes are not the signed bytes, so the HMAC never matches. This is not a preference, it is a correctness requirement, and it is why the raw body is preserved.

### Store a long-lived installation token to avoid the JWT exchange

Rejected. It reintroduces the long-lived, at-rest repository credential that ADR-0002 chose the GitHub App specifically to avoid. On-demand minting is the whole point of the App model.

### Identify the tenant from a field in the webhook body

Rejected as stated: the webhook is resolved to rows by branch or stored pull request URL, and it is trusted only because the HMAC proves the body is GitHub's. A body-supplied tenant id, even signed, would be honouring a claim rather than deriving identity, the same anti-pattern ADR-0009 rejects for the API.
