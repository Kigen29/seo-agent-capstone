# Architecture

See `docs/adr/` for the decisions and their rationale. This file is the map.

## System diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15, App Router)                              │
│  Dashboard · Scorecard · Findings inbox · PR review · Reports    │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST + SSE
┌───────────────────────────▼──────────────────────────────────────┐
│  apps/api  (Fastify)                                             │
│  Auth · Tenancy · Job enqueue · Budget guard · Audit log         │
└───────────────────────────┬──────────────────────────────────────┘
                            │ BullMQ (Redis)
┌───────────────────────────▼──────────────────────────────────────┐
│  apps/worker                                                     │
│  crawl · evaluate · fetch-gsc · fetch-cwv · poll-ai · fix · verify│
└───┬──────────┬──────────┬──────────┬──────────┬──────────────────┘
    │          │          │          │          │
┌───▼────┐┌────▼─────┐┌───▼────┐┌────▼───┐┌─────▼──────┐
│crawler ││  rules   ││connect-││ fixers ││   agent    │
│Playwr- ││ ~40 pure ││  ors   ││ + vcs  ││ LLM orch.  │
│ight    ││ functions││ GSC/PSI││ GitHub ││ skills     │
│        ││ ZERO LLM ││ CrUX...││  App   ││ Haiku/Sonnet│
└────────┘└──────────┘└────────┘└────────┘└────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  Postgres (RLS by tenant_id) · Object store · Vector store        │
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
| Strategy / Adapter | `VersionControlProvider`, `LLMProvider`, `SerpProvider` | Swap GitHub for GitLab, Sonnet for GPT, SerpApi for DataForSEO, without touching call sites |
| Repository | `packages/db` | Keeps Drizzle out of the domain logic; makes tenancy enforceable in one place |
| Pipeline / Chain | crawl -> evaluate -> prioritise -> fix -> verify | Each stage is independently testable and resumable |
| Saga | AI visibility 3-day poll; CWV 28-day verification window | Long-horizon stateful workflows that outlive any process |
| Registry | `packages/rules/src/registry.ts` | Rules self-register; adding a rule touches one file |
| Guard | per-tenant budget guard on every paid call | Cost blowout is the #1 operational risk in an LLM product |
