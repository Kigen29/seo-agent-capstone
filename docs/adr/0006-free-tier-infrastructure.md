# ADR-0006: Zero-cost infrastructure. Postgres as the queue, GitHub Actions as the worker.

**Status:** Accepted. The Supabase choices below (Postgres host, and Supabase Storage for artefacts) are superseded by [ADR-0007](0007-neon-postgres-over-supabase.md): the database is now plain Postgres on Neon, and artefacts live in that database. Everything else here stands, including pg-boss as the queue and GitHub Actions as the worker fleet. Body left as written, per the never-edit-an-accepted-ADR convention.
**Date:** 2026-07-12

## Context
The project has no budget. Every component must run on a permanent free tier.

Two constraints bite hardest:

1. **The crawler is heavy.** A 500-page Playwright crawl will not run inside a Render free web service, which spins down after 15 minutes of idle and is not sized for a headless browser.
2. **Free Redis is too small to be a job queue.** Upstash's free tier is 10,000 commands per day. A single 500-page crawl with per-page progress updates would exhaust it.

Separately, the Quantic handbook explicitly permits and encourages a public repository as a portfolio artefact. Public GitHub repositories get **unlimited free Actions minutes**.

## Decision

**Drop Redis. Use `pg-boss` on the Postgres we already have.**
`pg-boss` provides a durable job queue, scheduling, retries, exponential backoff, and dead-letter handling, entirely inside Postgres. One fewer service, one fewer free tier, and no command-count ceiling.

**Make the repository public and use GitHub Actions as the worker fleet.**

```
apps/api (Render free)
  -> enqueue in pg-boss (Supabase Postgres)
  -> fire repository_dispatch to GitHub
      -> Actions runner claims the job
      -> runs the crawl / audit / AI poll (Chromium already installed, 6h limit, free)
      -> writes results back to Postgres
      -> marks the job complete
```

Long-horizon work maps naturally onto `schedule:` cron triggers: the 3-day AI visibility poll, the 28-day CrUX verification window.

## Consequences

### Good
- Total infrastructure cost: **zero**, permanently.
- Ephemeral, isolated, generously-sized compute for the heaviest workload, for free.
- Chromium and the Playwright dependencies come preinstalled on the runner.
- pg-boss keeps the job ledger transactionally consistent with the domain data, in one database. No dual-write problem between Redis and Postgres.
- Every worker run has a public log, which is genuinely useful for the capstone demo and for debugging.

### Bad
- Actions job start-up latency is 20 to 60 seconds. Unacceptable for a synchronous UX, fine for a job that takes minutes anyway. The UI shows queued state.
- Public repo means the code is public. Secrets must live in GitHub Actions secrets and Render env vars, never in the repo. The `.gitignore` and the pre-commit hook must be airtight.
- GitHub Actions is not a general-purpose autoscaler. If we ever have real customers with concurrent crawls, this must be replaced with a real worker pool. **Documented as a known scaling ceiling, deliberately accepted for a capstone and an MVP.**
- Render free web services cold-start after 15 minutes idle. Mitigate with a keep-alive ping before the demo.

### Neutral
- Forces genuine discipline about secret handling, which is a good habit anyway.

## Alternatives considered

### Redis + a dedicated worker process on Render
Rejected. Render background workers are a paid product, and free Redis tiers throttle at a single crawl.

### Serverless functions (Vercel, Cloudflare Workers)
Rejected. Execution time limits and cold starts are hostile to Playwright. Cloudflare Workers cannot run a full browser without Browser Rendering, which is paid.

### Run the worker on the developer's own machine
Rejected as the production answer, though it is the correct answer for local development.

## Migration trigger
If concurrent crawls exceed roughly 20 per hour, or if we take on a paying client with an SLA, replace GitHub Actions with a real worker pool (Fly.io machines or a small VPS). The `pg-boss` layer does not change; only the consumer does. That is why the queue and the runner are decoupled.
