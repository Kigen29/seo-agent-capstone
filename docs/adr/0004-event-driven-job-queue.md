# ADR-0004: Event-driven job queue over synchronous request-response

**Status:** Accepted. The event-driven decision stands. The **mechanism** below (BullMQ on Redis) is superseded by [ADR-0006](0006-free-tier-infrastructure.md), which keeps the queue but moves it to pg-boss on Postgres and moves the workers to GitHub Actions. The body of this ADR is left as written, per the never-edit-an-accepted-ADR convention.
**Date:** 2026-07-12

## Context
A full audit involves: crawling up to 500 pages with a headless browser, calling PageSpeed Insights per template page, pulling Search Console data across multiple dimensions with pagination, polling several AI engines three times each across several days, and generating code fixes with an LLM.

This takes minutes to days, not milliseconds. It cannot live inside an HTTP request. External APIs rate limit us, fail transiently, and impose hard daily quotas (Search Console URL Inspection is capped at 2,000 per day per property).

## Decision
An event-driven architecture with a durable job queue (BullMQ on Redis). The API enqueues; workers process; the web app subscribes to progress.

Jobs are **idempotent** and **resumable**. A crawl that dies at URL 47 restarts at URL 48. Every job carries a tenant id and passes through a per-tenant budget guard before making any paid call.

Long-horizon jobs (the 3-day AI visibility poll, the 28-day CrUX verification window) are modelled as scheduled, stateful sagas, not as long-running processes.

## Consequences

### Good
- Retries, backoff, and dead-letter queues come free.
- Quota management becomes centralised and enforceable.
- Horizontal scaling of workers is trivial.
- The 28-day CrUX wait is expressible as a first-class scheduled job rather than a hack.

### Bad
- More moving parts: Redis, workers, a scheduler.
- Eventual consistency in the UI. We need progress streaming and optimistic states.
- Harder to test end to end.

## Alternatives considered

### Synchronous HTTP
Rejected. A 500-page Playwright crawl will never complete inside a request timeout.

### Serverless functions with fan-out
Deferred. Attractive for cost, but cold starts and execution time limits are hostile to Playwright, and the free tiers we are targeting for the capstone make a persistent worker simpler.
