# Security

## Reporting a problem

Open a private security advisory on this repository (Security, then "Report a vulnerability"). Please do not open a public issue for something exploitable. Include what you did, what happened and what you expected.

## What is in place

Each line names where it lives, so it can be checked and not just believed.

**Data**

- Every query is built by Drizzle with bound parameters. There is one `sql.raw` in the codebase, in `packages/db/src/client.ts`, and it interpolates a constant role name.
- Postgres row-level security is forced on every tenant table, and every request runs inside a transaction scoped to one tenant (`withTenant`). Another tenant's row is a 404, never a 403. See ADR-0008.
- The web app holds no database credential and cannot import the database package; ESLint fails the build if it tries (ADR-0009).

**Secrets**

- Session and API tokens are 256 random bits, stored only as SHA-256 hashes, and compared in constant time (`apps/api/src/auth.ts`).
- Google refresh tokens and hosting tokens are encrypted at rest with AES-256-GCM, a fresh nonce per value, and an authentication tag that makes tampering a decryption failure (`packages/connectors/src/google/crypto.ts`). The key is `TOKEN_ENCRYPTION_KEY` and lives only in the host's environment.
- The session cookie is `httpOnly`, `SameSite=Lax` and `Secure` in production. The token never reaches browser JavaScript.
- No Google password is ever asked for. OAuth 2.0 only.
- Nothing secret is in this repository, which is public. Secrets live in GitHub Actions secrets, Render and Vercel. Pull requests are scanned for committed secrets.

**The edge of the API** (ADR-0038, `apps/api/src/protect.ts`)

- Rate limits: per account for signed-in requests, per address for anonymous ones, tighter for anything that calls a model or a paid search, and a per-address ceiling over everything.
- Paid work is also capped per account per month in Postgres (ADR-0016), which is what bounds cost.
- The web app signs each anonymous visitor's address when it calls the API for them, and the API believes only a signed, recent one, so a visitor cannot claim a new address to dodge a limit (ADR-0043, `packages/core/src/visitor-address.ts`).
- Request bodies are capped at 256 KB and must arrive within 30 seconds.
- Security headers on every response, including refusals. CORS allows no origin unless one is named.
- Authentication runs before validation, so an unauthenticated caller learns nothing about a route's shape.
- Server errors return no detail. The message goes to the log, with authorisation headers and cookies redacted.

**Requests the server makes**

- Every fetch of an address a user supplied goes through an SSRF guard that resolves the host and refuses private, loopback and link-local ranges.
- Webhooks from GitHub and the payment rail are refused without a valid HMAC signature over the raw body.

**The web app** (`apps/web/next.config.mjs`)

- A content security policy that loads scripts, styles and fonts from the app's own origin only, forbids framing and plugins, and pins `<base>`.
- `X-Frame-Options`, `nosniff`, a referrer policy, a permissions policy that switches off camera, microphone, location and payment, and HSTS in production.
- Redirect targets after sign-in are checked to be a path on this origin (`safeNext`).

**The agent**

- It never pushes to a default branch. Every change is a pull request on its own branch, and the code path has no capability to do otherwise.
- It never sends outreach. It drafts, and a person sends from their own mail.

**The build**

- Every CI workflow's token is read-only or has no permissions.
- `pnpm audit --prod` reports no known vulnerabilities as of 8 October 2026.

## Known limits

Stated so they are not mistaken for oversights. The reasoning for each is in ADR-0038.

- The rate limiter is in memory. A restart forgets the counts, and it would be per instance if the API ran on more than one.
- The web content policy allows inline scripts, which the framework needs unless every page renders on demand.
- Anonymous limits are counted per visitor only when `VISITOR_ADDRESS_SECRET` is set on both the web app and the API (ADR-0043). Until then they count the web server's address, every visitor shares one allowance, and the free check's global daily cap is the real bound.
- A process cannot absorb a volumetric attack. That is left to the hosting platform's edge network.
