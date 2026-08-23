# Architecture

See `docs/adr/` for the decisions and their rationale. This file is the map.

## System diagram

```
┌───────────────────────────────────┐┌─────────────────────────────┐
│  apps/web  (Next.js 15)           ││  apps/mcp  (stdio, local)   │
│  Vercel Hobby, free               ││  Claude Code / Cursor       │
│  Dashboard · Scorecard · Findings ││  5 read + 3 write tools     │
│  inbox · PR review · Reports      ││  fix_finding opens the PR   │
└───────────────────────────┬───────┘└──────────┬──────────────────┘
                            │ REST + SSE        │ REST (ADR-0020)
                            └─────────┬─────────┘
┌────────────────────────────────────▼─────────────────────────────┐
│  apps/api  (Fastify)                    Render free web service  │
│  Auth · Tenancy · Job enqueue · Budget guard · Audit log         │
│  Two doors in, one door out. Nothing else touches Postgres.      │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 1. enqueue in pg-boss (Postgres)
                            │ 2. fire repository_dispatch
┌───────────────────────────▼──────────────────────────────────────┐
│  apps/worker      GitHub Actions runner, free, Chromium preinst. │
│  Claims the job from pg-boss, runs it, writes results back.      │
│  crawl · evaluate · fetch-gsc · fetch-cwv · poll-ai · fix · verify│
└───┬──────────┬──────────┬──────────┬──────────┬──────────────────┘
    │          │          │          │          │
┌───▼────┐┌────▼─────┐┌───▼────┐┌────▼───┐┌─────▼──────┐
│crawler ││  rules   ││connect-││ fixers ││   agent    │
│Playwr- ││ 23 pure  ││  ors   ││ + vcs  ││ LLM orch.  │
│ight    ││ functions││ GSC/PSI││ GitHub ││ skills     │
│        ││ ZERO LLM ││ CrUX...││  App   ││ fast/smart │
└────────┘└──────────┘└────────┘└────────┘└─────┬──────┘
                            │                   │ roles, never vendors
                            │             ┌─────▼──────┐
                            │             │ @seo/llm   │
                            │             │ chain from │
                            │             │ .env       │
                            │             └────────────┘
┌───────────────────────────▼──────────────────────────────────────┐
│  Plain Postgres on Neon, free tier. One database, four jobs:      │
│  Drizzle (data, RLS by tenant_id) · pg-boss (queue) · pgvector    │
│  · compressed crawl artefacts. No Redis, no object store.         │
│  Only DATABASE_URL. See ADR-0006 and ADR-0007.                    │
└──────────────────────────────────────────────────────────────────┘
```

## The critical boundary

```
        DETERMINISTIC                    │            PROBABILISTIC
                                         │
  crawler  ->  rules  ->  Finding[]      │   Finding  ->  agent  ->  diff  ->  PR
                                         │
  Reproducible. Testable. Free.          │   Reviewed by a human. Always.
  This is where DETECTION happens.       │   This is where FIXING happens.
```

Never move detection across that line. ADR-0001.

## Patterns in use

| Pattern | Where | Why |
|---|---|---|
| Strategy / Adapter | `VersionControlProvider`, `@seo/llm` providers, `SerpProvider`, `BacklinkProvider`, `KeywordProvider` | Swap GitHub for GitLab, or one model vendor for another, or SerpApi for DataForSEO, without touching call sites. One interface per **product line**, not per vendor: SerpApi sells SERP data and no backlinks, so an interface covering both would force it to implement a method it cannot honour. ADR-0021 |
| Role-based indirection | `@seo/llm`: code asks for `fast` / `smart` / `embed` / `judge` / `poll` | No vendor or model name appears in application code. Swapping a model is a `.env` edit, enforced by an ESLint rule that confines vendor SDKs to `providers.ts`. ADR-0005 |
| Decorator | `budgeted(provider)` around a `SerpProvider` | The cap wraps the vendor rather than living inside it, so every future adapter arrives already capped and the adapter stays a pure translation of one vendor's shape. ADR-0016 |
| Chain of responsibility | The per-role fallback chain, e.g. `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro` | Falls through on 429, quota, or 5xx. Targets whose API key is absent are dropped silently, so the free tier degrades instead of breaking |
| Repository | `packages/db` | Keeps Drizzle out of the domain logic; makes tenancy enforceable in one place |
| Pipeline / Chain | crawl -> evaluate -> prioritise -> fix -> verify | Each stage is independently testable and resumable |
| Saga | AI visibility 3-day poll; CWV 28-day verification window | Long-horizon stateful workflows that outlive any process |
| Registry | `packages/rules/src/registry.ts` | Rules self-register; adding a rule touches one file |
| Guard | `@seo/budget`: a per-tenant cap checked before every paid call, LLM and SERP alike | Cost blowout is the #1 operational risk in an LLM product. Checked before the spend and failing closed, so the worst case is a dark axis rather than a bill. ADR-0017 |
| Facade | `apps/mcp`: eight tools over the REST API, for agents rather than browsers | The write path is the product's differentiator and was reachable only from the dashboard. The facade holds no database handle, which ESLint enforces rather than trusts, and its write half is unregistered unless asked for and capped when it is. ADR-0020 |
