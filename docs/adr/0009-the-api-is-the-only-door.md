# ADR-0009: The API is the only door to the database

**Status:** Accepted
**Date:** 2026-07-14

## Context

The backlog had a hole in it. `apps/api` (Fastify, on Render's free web service) is named in the CLAUDE.md repo layout and drawn in the [architecture.md](../architecture.md) system diagram, but **no story ever asked anyone to build it**. STORY-012, the dashboard, quietly assumed it already existed.

So when the dashboard came to be built, the path of least resistance was to read Postgres directly from React Server Components. That is a legitimate, widely used Next.js pattern. It is not wrong in the abstract. It was wrong here, and the reasons are worth writing down because none of them are "direct database access is bad practice".

## Decision

**Every read and write to Postgres goes through the API. Nothing else holds a database handle.**

Concretely: `@seo/db` may be imported by `apps/api`, `apps/worker`, `packages/audit` (which the worker runs), and `packages/db` itself. Nowhere else. The web app talks to the API over HTTP through a typed client (`@seo/api-client`) and holds no `DATABASE_URL`.

### Why, specifically

1. **Connection exhaustion.** Every Vercel serverless invocation opens its own pool. Neon's free tier has a hard connection ceiling, and a traffic spike, or simply a burst of prerendering, would exhaust it. Render is one long-lived process with one pool, which is exactly the shape a connection-limited database wants.

2. **We need the service regardless.** OAuth callbacks (STORY-009), GitHub App webhooks (sprint 2), and `repository_dispatch` to the worker (ADR-0006) all need a long-lived server that is not Vercel. Skipping the API would not have avoided the work, only deferred it while accruing a second data-access path to unpick later.

3. **Blast radius.** Reading from the web app means `DATABASE_URL` lives in Vercel's environment as well as Render's. That is the **owner** credential, and on Neon it carries `BYPASSRLS` (ADR-0008). One credential, in two places, one of which is a CDN edge platform, for no gain.

4. **The deployed system must match the design document.** The graded artefact is generated from `docs/adr/` and `architecture.md`. If those describe a Fastify API while production reads the database directly, the document is not a description, it is a wish.

### Enforced, not requested

A rule nobody can enforce is a rule nobody keeps. `@seo/db` is a **restricted import** in `eslint.config.mjs`, allow-listed to the four locations above. Import it from `apps/web` and CI fails with a message that says where to go instead. This is the same mechanism that keeps vendor LLM SDKs confined to one file (ADR-0005), and it exists for the same reason: the architecture should be a property of the build, not of anyone's memory.

## Authentication, and why it is load-bearing

The API cannot call `withTenant` until it knows the tenant, and it must not take the caller's word for it. **A header saying "I am tenant X" is not authentication, it is a request to *be* tenant X.** Honouring one would make row-level security decorative all over again, after all the work in ADR-0008 to make it real.

So the tenant is derived from a bearer token and from nothing else. Tokens are stored as a SHA-256 hash, never in plaintext: we can verify a presented token by hashing it, and we are incapable of printing one back even if asked. Losing a token means minting a new one, which is the correct trade, because a database dump is the most plausible way to lose these and a leaked token is a live credential to somebody's account.

Resolving a token to a tenant necessarily runs *before* any tenant context exists, so it goes through `asOwner`, exactly like creating a tenant. Both belong to the same small class: **operations that logically precede a tenant, and therefore cannot be scoped by one.** That class should stay small enough to count on one hand.

## 404, never 403

A request for another tenant's resource returns **404, not 403**.

The difference matters more than it looks. A 403 confirms that the row is real. An attacker who can tell 403 from 404 can enumerate which audit ids exist across the whole platform, infer how many customers we have and how active they are, and confirm that a named competitor is a customer, **all without ever reading a byte of anyone's data**.

Row-level security makes this honest rather than performative. The query returns no rows, so the handler genuinely cannot distinguish "not yours" from "not there" either. The code is not pretending ignorance; it is ignorant.

## Consequences

**Good.** One door, and it validates (Zod, at the boundary, before any query runs), authenticates (`onRequest`, before Fastify parses or reveals anything), and scopes (`withTenant`, so Postgres enforces isolation even if a handler forgets). Adding a second data path now requires editing an allow-list, which is a conversation, not an accident.

**Cost.** An extra network hop between Vercel and Render, and the free Render instance **spins down after ~15 minutes idle and takes 30 to 60 seconds to wake**. That is a real property of the product, not a footnote: the dashboard must handle a cold start honestly rather than showing a broken page, and the sprint demo should wake the service before it begins. This is the price of the $0 constraint in ADR-0006, and it is the honest price to quote.

**Auth lifecycle subtlety, found by a test.** Authenticating in `preHandler` was wrong: Fastify runs schema validation *before* `preHandler`, so an anonymous caller sending a malformed uuid received a 400 rather than a 401. That 400 confirms the route exists and describes its schema to somebody holding no credentials, letting a prober map the API surface without a token. Authentication now runs in `onRequest`, the first hook in the lifecycle.

## Alternatives considered

**React Server Components reading Postgres directly.** Rejected for the four reasons above. Worth restating that this is a good pattern in many applications, and the objection here is specific to a connection-limited free-tier database, a credential with `BYPASSRLS`, and a graded design document that has to be true.

**A Next.js route handler as the API.** Keeps one deployment and one language. Rejected: it is still Vercel, so it still has the connection-pool problem and still needs `DATABASE_URL` at the edge, and it cannot host a long-lived webhook or job-dispatch endpoint. It solves the tidiness objection and none of the real ones.

**tRPC instead of REST.** Attractive: end-to-end types with no hand-written client. Rejected for now because the API will have non-browser callers (the GitHub App webhook, the worker, and eventually customers), and those want a plain HTTP contract with an OpenAPI document rather than a TypeScript-specific RPC protocol. The typed client in `@seo/api-client` recovers most of the ergonomic benefit.
