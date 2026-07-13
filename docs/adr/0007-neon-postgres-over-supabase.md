# ADR-0007: Plain Postgres on Neon, and crawl artefacts in the database

**Status:** Accepted
**Date:** 2026-07-13
**Supersedes:** the Supabase choices in [ADR-0006](0006-free-tier-infrastructure.md). The rest of ADR-0006 stands: pg-boss is still the queue, GitHub Actions is still the worker fleet, and the total cost is still zero.

## Context

ADR-0006 picked Supabase for three separate jobs: the Postgres database, object storage for crawl artefacts, and (optionally) auth. That bundling was the appeal. On reflection it is also the problem.

Three things pushed us off it:

1. **Supabase's free tier pauses a project after 7 days of inactivity.** A capstone is exactly the kind of project that sits idle between sprints and then has to work on demand during a recorded demo or a grader's visit. A paused database is a failed demo.
2. **We want a database, not a platform.** We use Postgres through Drizzle, pg-boss, and pgvector. We do not use PostgREST, Supabase Auth, Realtime, or Edge Functions. Adopting the platform meant taking a vendor SDK and a service-role key for capabilities we were never going to call.
3. **Object storage was a second free tier to babysit** for what is, at capstone scale, a small amount of data.

## Decision

**Postgres on Neon's free tier, addressed only by `DATABASE_URL`.**

Neon does not pause on idle, it supports `pgvector`, and it is plain Postgres. No vendor SDK, no service-role key, no platform-specific code anywhere in the repo. The connection string is the entire integration surface.

The practical consequence, and the point of writing it down: **nothing in the codebase knows it is talking to Neon.** Swapping to Render Postgres, RDS, or a Postgres in a container on a laptop is an environment variable change. This is the same principle as ADR-0005, where application code asks for an LLM role and never names a vendor.

**Crawl artefacts live in Postgres, not in object storage.**

Raw HTML and screenshots are stored compressed in the database, pruned to the latest crawl per site. At 500 pages per crawl this is small, it removes an entire service, and it keeps the artefact transactionally consistent with the crawl row that references it, so we cannot end up with a finding whose evidence has been garbage collected.

## Consequences

### Good
- One backing service instead of two. One credential (`DATABASE_URL`) instead of three.
- No idle pausing, so the deployed capstone answers on the first request during a demo.
- Zero vendor lock-in. The database is a commodity, addressed as one.
- Artefacts and the findings that cite them commit or roll back together.

### Bad
- **Storing blobs in Postgres does not scale**, and we know it. Neon's free tier is ~0.5 GB. Aggressive pruning (latest crawl per site only, screenshots downsampled) keeps a capstone inside it, but this is the first thing that breaks with real customers.
- We give up Supabase Auth, so auth is Auth.js with GitHub OAuth. That is a small amount of extra work, and it was always the more likely choice given the GitHub App integration.

### Neutral
- Migrating later is cheap precisely because the integration surface is one environment variable.

## Migration trigger

Move artefacts to S3-compatible object storage (Cloudflare R2's free tier is 10 GB with no egress fees) when **artefact storage passes roughly 300 MB**, or when a single crawl's artefacts exceed what we are willing to hold in a transaction. The `ArtefactStore` interface exists so that the change is one implementation, not a rewrite: exactly the Strategy pattern used for `VersionControlProvider` and the LLM providers.

## Alternatives considered

### Stay on Supabase
Rejected. The 7-day idle pause is a direct risk to a graded demo, and we were adopting a platform to use one commodity part of it.

### Render Postgres
Rejected. Render's free Postgres instances expire after 30 days, which would take the database out from under the deployed capstone mid-marking.

### Cloudflare R2 for artefacts now
Deferred, not rejected. It is the right answer at scale and it is the documented migration trigger above. It is a second service and a second set of credentials to solve a problem we do not have at 500 pages.
