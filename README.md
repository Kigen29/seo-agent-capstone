# Rankwright (working name)

An autonomous SEO agent that connects to your repository, audits your entire search surface, and **opens pull requests that fix what is broken**.

> Every other AI-SEO tool sends your marketer a list. We send your repo a pull request.

**Live deployment:** [seo-agent-capstone.vercel.app](https://seo-agent-capstone.vercel.app)
**Task board:** [GitHub Projects](https://github.com/users/Kigen29/projects/3)
**Design and testing document:** [`docs/design-and-testing.md`](docs/design-and-testing.md) _(the graded deliverable: decisions, patterns, deployment cost, and testing)_

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
| [`docs/design-and-testing.md`](docs/design-and-testing.md) | The graded design and testing document: decisions, patterns, deployment cost, testing |
| [`docs/architecture.md`](docs/architecture.md) | System map and patterns |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/sprint-1-backlog.md`](docs/sprint-1-backlog.md) | User stories |

## Getting started

Node 24 and pnpm 9. `DATABASE_URL` is the only variable you need to run the tests; the rest of
`.env.example` turns on the connectors, and every one of them degrades to an honestly unmeasured
axis when its key is absent.

```bash
pnpm install
cp .env.example .env      # then fill it in; DATABASE_URL is the one that matters
pnpm db:migrate
pnpm dev                  # the Next dashboard and the Fastify API together
```

## Testing

```bash
pnpm test           # the whole suite: unit, integration, and contract tests
pnpm test:e2e       # Playwright, against the real app and a real database
pnpm lint           # includes the architectural rules (see below)
```

`pnpm test` is the full run, not just the unit tests. Integration and contract tests live beside
the unit tests in each package and are part of the same command; the ones that touch Postgres
need `DATABASE_URL` and are the reason CI runs a Postgres service container.

The LLM evaluation harness (precision, recall, and hallucination rate against a golden dataset)
is designed but not built. See section 4.5 of the design and testing document for the method and
why the `judge` role must be a different model family than the model under test.

## The one architectural law

**Deterministic detection first, LLM second.** A parser finds the issue. The LLM only explains it and writes the fix. See [ADR-0001](docs/adr/0001-deterministic-first-llm-second.md).

---

Quantic School of Business and Technology, MSSE Capstone, 2026.
