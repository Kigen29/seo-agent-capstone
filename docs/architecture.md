# Architecture

See `docs/adr/` for the decisions and their rationale. This file is the map.

## System diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15, App Router)          Vercel Hobby, free  │
│  Dashboard · Scorecard · Findings inbox · PR review · Reports    │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST + SSE
┌───────────────────────────▼──────────────────────────────────────┐
│  apps/api  (Fastify)                    Render free web service  │
│  Auth · Tenancy · Job enqueue · Budget guard · Audit log         │
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
│Playwr- ││ ~40 pure ││  ors   ││ + vcs  ││ LLM orch.  │
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
| Strategy / Adapter | `VersionControlProvider`, `@seo/llm` providers, `SerpProvider` | Swap GitHub for GitLab, or one model vendor for another, or SerpApi for DataForSEO, without touching call sites |
| Role-based indirection | `@seo/llm`: code asks for `fast` / `smart` / `embed` / `judge` | No vendor or model name appears in application code. Swapping a model is a `.env` edit, enforced by an ESLint rule that confines vendor SDKs to `providers.ts`. ADR-0005 |
| Chain of responsibility | The per-role fallback chain, e.g. `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro` | Falls through on 429, quota, or 5xx. Targets whose API key is absent are dropped silently, so the free tier degrades instead of breaking |
| Repository | `packages/db` | Keeps Drizzle out of the domain logic; makes tenancy enforceable in one place |
| Pipeline / Chain | crawl -> evaluate -> prioritise -> fix -> verify | Each stage is independently testable and resumable |
| Saga | AI visibility 3-day poll; CWV 28-day verification window | Long-horizon stateful workflows that outlive any process |
| Registry | `packages/rules/src/registry.ts` | Rules self-register; adding a rule touches one file |
| Guard | per-tenant budget guard on every paid call | Cost blowout is the #1 operational risk in an LLM product |
