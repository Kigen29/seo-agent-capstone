---
description: Generate the Quantic design and testing document from the ADRs and architecture notes
allowed-tools: Read, Write, Glob, Bash
---

Generate `docs/design-and-testing.md`, the graded Quantic capstone deliverable.

Read every file in `docs/adr/`, plus `docs/architecture.md`, plus the CI config, plus every test file, before writing a word.

The rubric requires, explicitly:
1. **Design and architecture decisions made**, including technologies and architectural choices and the reasons for these
2. **Any software and architectural patterns used and the reasons used**
3. **Deployment options recommended** (on-premises or cloud) **including relative cost implications of the choice**
4. **All software testing carried out**, including any and all automated tests used **and reasons why**

Cover, at minimum:
- Event-driven job queue over synchronous request-response, and why
- GitHub App over personal access token, and why
- OAuth per tenant over service account for Search Console, and why
- Strategy / Adapter pattern for `VersionControlProvider` and for the `@seo/llm` providers, and why
- Role-based LLM addressing (`fast` / `smart` / `embed` / `judge`) over naming vendors in code, and why. Note that an ESLint rule confines vendor SDKs to `providers.ts`, so the law is enforced by CI rather than by memory
- Deterministic-first, LLM-second detection architecture, and why (this is the most important decision in the codebase)
- Repository pattern over direct ORM calls
- Multi-tenancy model: row-level security in Postgres, tenant_id on every table
- Zero-cost infrastructure (ADR-0006 and ADR-0007): pg-boss on plain Postgres as the queue, GitHub Actions on a public repo as the worker fleet, one database holding data, queue, vectors and crawl artefacts. Explain the Redis rejection, the Supabase rejection (idle pausing, and adopting a platform to use one commodity part of it), and the known scaling ceilings that were deliberately accepted, with their documented migration triggers
- Deployment cost table: free tier (Vercel + Render + Neon + GitHub Actions, total $0) vs cloud (AWS ECS + RDS + ElastiCache + S3) vs on-premises, with actual monthly figures in USD
- Testing pyramid: unit (rule engine, 100% deterministic), integration, contract tests per external API, e2e, and the **LLM evaluation harness** measuring precision, recall, and hallucination rate against a golden dataset

Use no em dashes.
