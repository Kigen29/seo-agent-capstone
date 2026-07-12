# Rankwright (working name)

An autonomous SEO agent that connects to your repository, audits your entire search surface, and **opens pull requests that fix what is broken**.

> Every other AI-SEO tool sends your marketer a list. We send your repo a pull request.

**Live deployment:** _(add the Render/Vercel URL here before submission)_
**Task board:** _(add the Trello / GitHub Projects URL here before submission)_
**Design and testing document:** `docs/design-and-testing.md` _(generated from the ADRs via `/design-doc` before submission)_

---

## What it does

Audits eight independent surfaces, then fixes what it can in code:

1. **Crawl health** - robots.txt, sitemaps, canonicals, indexation, redirects, orphans, AI crawler posture
2. **Performance** - Core Web Vitals from real CrUX field data
3. **Content** - depth, originality, freshness, cannibalisation, quick wins
4. **Structure** - internal link graph, click depth, schema.org
5. **Authority** - referring domains, brand mentions, digital PR angles
6. **Local** - Google Business Profile, NAP, geo-grid
7. **AI visibility** - citation rate and stability across ChatGPT, Perplexity, AI Overviews, Gemini, Claude
8. **Agent readiness** - llms.txt, Lighthouse Agentic Browsing, accessibility tree

Then: `crawl -> diagnose -> prioritise -> open a PR -> human merges -> verify in production -> prove it in Search Console`

## Docs

| File | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project memory. The non-negotiable rules. Read first. |
| [`docs/research-dossier.md`](docs/research-dossier.md) | The full SEO / AEO / GEO / LLMO research this is built on. Source of truth for every SEO claim. |
| [`docs/architecture.md`](docs/architecture.md) | System map and patterns |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/sprint-1-backlog.md`](docs/sprint-1-backlog.md) | User stories |

## Getting started

```bash
pnpm install
cp .env.example .env      # then fill it in
pnpm db:migrate
pnpm dev
```

## Testing

```bash
pnpm test           # unit (Vitest) - the rule engine, 100% deterministic
pnpm test:int       # integration - API clients against mocks
pnpm test:e2e       # Playwright
pnpm eval           # LLM eval harness: precision, recall, hallucination rate
```

## The one architectural law

**Deterministic detection first, LLM second.** A parser finds the issue. The LLM only explains it and writes the fix. See [ADR-0001](docs/adr/0001-deterministic-first-llm-second.md).

---

Quantic School of Business and Technology, MSSE Capstone, 2026.
