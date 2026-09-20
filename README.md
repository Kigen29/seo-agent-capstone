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

## Signing in

Sign in with **GitHub** or **Google**. Both reuse credentials the project already had: GitHub uses
the GitHub App's own client id and secret, and Google uses the same OAuth client as the Search
Console connection, so neither needs a new registration.

A social sign-in mints an ordinary API token and puts it in an httpOnly cookie. It is not a second
kind of session, which is why row-level security, `withTenant` and the MCP server are untouched by
it. See [ADR-0023](docs/adr/0023-social-sign-in-mints-an-api-token.md) for why, and for how the
token crosses from the API's origin to the web app's without ever appearing in a URL.

Set `<API_PUBLIC_URL>/auth/signin/callback` as a callback URL on both the GitHub App and the
Google OAuth client. A provider whose credentials are absent simply gets no button.

**This deployment is open**: anyone signing in gets a tenant, with the monthly cap in
`NEW_TENANT_BUDGET_MICROS` on the paid model and SERP calls. Set it to `0` to leave everything
free working (crawl, the 29 rules, the scorecard, fix pull requests, verification) while spending
nothing. The cap is per tenant, not global.

Pasting an API token still works, behind a disclosure on the login page. It is how the CLI, the MCP
server and the end-to-end suite authenticate.

## Testing

```bash
pnpm test           # the whole suite: unit, integration, and contract tests
pnpm test:e2e       # Playwright, against the real app and a real database
pnpm lint           # includes the architectural rules (see below)
```

`pnpm test` is the full run, not just the unit tests. Integration and contract tests live beside
the unit tests in each package and are part of the same command; the ones that touch Postgres
need `DATABASE_URL` and are the reason CI runs a Postgres service container.

The LLM evaluation harness (`packages/eval`) is built: it runs the finding engine against
hand-labelled pages and reports precision, recall and hallucination rate, and it asserts that the
`judge` role resolves to a different model family than the model under test. The golden dataset it
grades against is still small (one case, four pages, against a target of roughly fifty), so treat
the numbers as an instrument that works rather than a verdict that is settled. See section 4.5 of
the design and testing document for the method, and `packages/eval/README.md` for the labelling
rule that matters: never label from engine output.

## Use it from your editor (MCP)

The agent is also an [MCP](https://modelcontextprotocol.io) server, so Claude Code, Cursor or
any MCP client can drive it directly. Six read tools (`list_sites`, `list_findings`,
`get_finding`, `get_audit`, `audit_status`, `keyword_ideas`) and three write tools (`run_audit`,
`fix_finding`, `verify_site`).

`fix_finding` is the one that matters. Every other SEO MCP server hands your agent a list of
problems; this one opens the pull request that fixes it.

```bash
pnpm build
pnpm --filter @seo/api mint-token my-tenant     # prints a token, once
export SEO_API_TOKEN=seo_...
export SEO_MCP_ALLOW_WRITES=1                   # writes are off by default
```

The repo ships a `.mcp.json`, so Claude Code picks the server up inside this project. Writes
stay off unless `SEO_MCP_ALLOW_WRITES=1`, and a single server process will open at most
`SEO_MCP_MAX_PRS` pull requests (default 3) before it refuses: nothing here can reach your
default branch, but a model in a loop can still flood a reviewer. See
[ADR-0020](docs/adr/0020-mcp-server-as-a-second-door.md).

## The one architectural law

**Deterministic detection first, LLM second.** A parser finds the issue. The LLM only explains it and writes the fix. See [ADR-0001](docs/adr/0001-deterministic-first-llm-second.md).

---

Quantic School of Business and Technology, MSSE Capstone, 2026.
