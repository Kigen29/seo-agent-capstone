# CLAUDE.md

Project memory for Claude Code. Read this before doing anything.

---

## What we are building

**Codename:** Rankwright (working name, change it)

An autonomous SEO agent that connects to a client's Git repository, audits their entire search surface (technical SEO, Core Web Vitals, content, internal links, backlinks, local SEO, social presence, AI visibility, agent readiness), and then **opens pull requests that fix the issues**.

**The one-line positioning:**
> Every other AI-SEO tool sends your marketer a list. We send your repo a pull request.

**Why this exists:** every AI-visibility platform on the market (Profound, Peec, Otterly, Scrunch) is a dashboard. They measure the problem and leave the fixing to a human who usually cannot write code. Every technical SEO crawler (Screaming Frog, Ahrefs Site Audit) produces 400 findings and hands them to a marketer. Nobody closes the loop. We close the loop.

**The loop:**
```
crawl -> diagnose -> prioritise -> open a PR that fixes it -> human merges -> verify in production -> prove the movement in Search Console
```

Full research and rationale: `docs/research-dossier.md`. Read it once, then trust this file.

---

## Non-negotiable rules

These are architectural laws. Do not violate them, do not ask to violate them.

1. **Deterministic checks first, LLM second.** A parser finds the issue. The LLM only explains it and writes the fix. Never let an LLM be the *detector* for anything a parser, a crawler, or an API can detect. This is the single most important decision in the codebase. If you catch yourself prompting a model to "find SEO issues in this HTML", stop and write a rule instead.

2. **Never push to `main`. Ever.** All repo changes go through a pull request, on a branch named `seo-agent/<finding-id>-<slug>`.

3. **Every finding carries its falsification condition.** Each finding object must answer "how would we know this fix failed?" before it is allowed to become a PR. Unfalsifiable advice is banned.

4. **Every PR body must contain:** the finding, the evidence (metric, screenshot, or trace), the expected effect, the falsification condition, and a rollback note.

5. **Never ask the user for a Google password.** OAuth 2.0 only. Ever.

6. **Never auto-send outreach.** We draft. Humans send.

7. **Never buy links, generate PBN content, or mass-produce doorway pages.** Hard-refuse. Cap programmatic location pages: warn at 30, hard stop at 50.

8. **Never claim llms.txt improves Google rankings.** Google's own docs (June 2026) say Search ignores it. We ship llms.txt as *agent-readiness infrastructure*, never as GEO. Intellectual honesty is a product feature.

9. **Modular files.** One responsibility per file. No 800-line god modules. Separate the rule engine, the fix generators, the API clients, and the agent skills.

10. **No em dashes in any prose we generate.** Use commas, semicolons, or restructured sentences.

---

## Tech stack (decided; see ADRs before changing)

**Hard constraint: everything runs on a permanent free tier. Total infrastructure cost is $0.** See `docs/free-tier-stack.md` and ADR-0006.

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Language | TypeScript (strict) everywhere |
| Web app | Next.js 15 App Router, Tailwind, shadcn/ui, on **Vercel Hobby** |
| API | Fastify (REST) + Zod, on **Render free web service** |
| DB + queue + vectors | **Supabase Postgres free tier.** One database serves all three: Drizzle ORM for data, **pg-boss** for the job queue, **pgvector** for embeddings. **No Redis.** |
| Storage | Supabase Storage (crawl artefacts) |
| Workers | **GitHub Actions on a public repo (unlimited free minutes).** The API enqueues in pg-boss, then fires `repository_dispatch`. The runner claims the job, runs the crawl, writes results back. |
| Crawler | Playwright (Chromium, preinstalled on the runner) |
| LLM | **`@seo/llm`. Role-based, provider-agnostic.** Code asks for `fast` / `smart` / `embed` / `judge`. Provider and model resolve from `.env` as ordered fallback chains. |
| VCS integration | GitHub App (Octokit), behind `VersionControlProvider` |
| Tests | Vitest (unit + integration), Playwright (e2e) |
| CI/CD | GitHub Actions |

### LLM rules (ADR-0005)

- **Never name a provider or a model in application code.** Ask for a role.
  ```ts
  await llm.object({ role: 'smart', tenantId, schema, prompt })  // yes
  await openai.chat.completions.create({ model: 'gpt-4.1', ... }) // NO
  ```
- `packages/llm/src/providers.ts` is the **only** file allowed to import a vendor SDK.
- Adding an API key or swapping a model is a `.env` edit. Never a code change.
- Chains fall through on 429 / quota / 5xx: `LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro`
- Targets whose API key is absent are silently dropped from the chain.
- Always use `generateObject` with a Zod schema for anything the code parses. **Never parse free text.**
- `LLM_JUDGE` must be a **different model family** than the one under test, or the eval harness suffers self-preference bias.
- Cost discipline: the rule engine finds the issue, the LLM only writes the fix. **One `smart` call per fixable finding, not per page.**

### The public repo trade-off

The repo is **public** (the Quantic handbook encourages it, and it is what makes Actions minutes free). Therefore:
- Every secret lives in GitHub Actions secrets, Render env vars, or Vercel env vars. **Never in the repo.**
- `.env` is gitignored. Verify before every commit.
- If you ever commit a key by accident, rotate it immediately. Do not just delete the commit.

---

## Repo layout

```
apps/
  web/          Next.js dashboard
  api/          Fastify REST API
  worker/       BullMQ job processors (crawls, audits, polls)
packages/
  core/         Domain types: Finding, Audit, Site, Tenant, Severity
  crawler/      Playwright crawler + link graph builder
  rules/        Deterministic rule engine. ~40 checks. Pure functions. Zero LLM.
  fixers/       Framework-aware fix generators (Next.js, WordPress, Astro, ...)
  connectors/   GSC, PSI, CrUX, GA4, DataForSEO, SerpApi clients
  vcs/          VersionControlProvider interface + GitHubProvider
  agent/        LLM orchestration, skill loading, prompt templates
  db/           Drizzle schema + migrations
docs/
  research-dossier.md   The full SEO/AEO/GEO/LLMO research. Source of truth.
  architecture.md
  sprint-1-backlog.md
  adr/                  Architecture decision records
.claude/
  agents/       Sub-agent definitions
  commands/     Slash commands
```

---

## Domain model (get this right first)

```ts
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

type Axis =
  | 'crawl_health' | 'performance' | 'content' | 'structure'
  | 'authority' | 'local' | 'ai_visibility' | 'agent_readiness'

interface Finding {
  id: string
  siteId: string
  ruleId: string              // e.g. 'TECH-007'
  axis: Axis
  severity: Severity
  confidence: number          // 0..1
  title: string
  evidence: Evidence          // what we actually observed, machine-verifiable
  affectedUrls: string[]
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large'
  estimatedImpact: number     // 0..100
  falsification: string       // "how would we know this fix failed?"  REQUIRED
  fixable: boolean            // can a fixer generate a diff?
  status: 'open' | 'pr_open' | 'merged' | 'verified' | 'rejected' | 'wontfix'
  prUrl?: string
  baseline?: MetricSnapshot   // captured before the fix
  verification?: VerificationResult
}
```

**Priority score** = `severity_weight * confidence * estimatedImpact / effort_cost`. Sort the backlog by it.

**Never ship a single "SEO score out of 100."** Ship the eight-axis scorecard. The axes move independently and one number hides everything.

---

## The eight axes (what the product measures)

1. **Crawl health** - robots.txt, sitemap, canonicals, indexation, redirects, orphans, duplicates, hreflang, AI crawler posture
2. **Performance** - Core Web Vitals from CrUX field data (not Lighthouse)
3. **Content** - depth, originality, freshness, cannibalisation, quick wins
4. **Structure** - internal link graph, click depth, schema.org
5. **Authority** - referring domains, brand mentions, digital PR
6. **Local** - Google Business Profile, NAP, geo-grid, LocalBusiness schema
7. **AI visibility** - multi-engine citation rate, stability, share of voice
8. **Agent readiness** - llms.txt, Lighthouse Agentic Browsing, accessibility tree, WebMCP

---

## Facts the agent must never get wrong

These come from primary sources. If a generated recommendation contradicts one of these, it is a bug.

**Core Web Vitals** (thresholds unchanged since INP replaced FID on 12 March 2024):
- LCP good <= 2.5s, poor > 4.0s
- INP good <= 200ms, poor > 500ms
- CLS good <= 0.1, poor > 0.25
- Measured at the **75th percentile of real Chrome users over a rolling 28-day window** (CrUX field data)
- **Lighthouse does not measure Core Web Vitals.** It is lab data. It cannot measure INP at all; it uses Total Blocking Time as a proxy. A green Lighthouse score with a red Search Console report is normal, not a bug.
- A fix does not appear in CrUX for up to 28 days. Always tell the user this.
- Fix order: whatever is in the poor band first, then INP (hardest), then LCP (biggest commercial impact), then CLS (easiest). Never optimise a green metric.

**Google's generative AI position** (official guide, 15 May 2026, updated 15 June 2026):
- AI Overviews and AI Mode run on the **same core ranking systems** as Search. Not a separate index.
- Mechanisms: **RAG** (must be indexed and rankable to be retrieved and cited) and **query fan-out** (one query spawns sub-queries).
- Google explicitly folds AEO and GEO into SEO.
- Tactics Google says to **ignore**: llms.txt, content chunking, AI-specific rewriting, special schema or Markdown versions, seeded inauthentic brand mentions.
- Structured data is **not required** for AI features. Keep it for rich results only.
- The biggest long-term factor is **non-commodity content**: first-hand experience, original data, real numbers.

**AI citation mechanics** (HeyTony 100-query control-group study, June 2026; Ahrefs 4M-URL study):
- Only ~38% of AI Overview citations also rank in the top 10. Ranking and citation are **two different contests**.
- **45.3% of citations appear in only one of three checks.** Never report a citation from a single poll. Poll each prompt **at least 3 times across different days** and report a stability score.
- Strongest predictor of a stable citation: **geographic scope matching** the answer's scope. A city-scoped page cannot support a country-level answer.
- Second: **consensus agreement**. The AI writes the answer first, then picks pages that support the sentences it already wrote. State the consensus range plainly, then layer your real numbers underneath.
- Most AI Overviews are built from **one skeleton page**. The target is to be the page the answer is built from, so the money page needs the range, the tiers, the drivers, and the caveat all in one place.
- What does **not** work: heavy formatting, FAQ blocks, fact density, question-format matching. ~85% of page-one results already have them, so they do not separate winners from losers.
- What does work: **one specific, true, concrete fact nobody else has** in everything you publish.

**Off-page** (Ahrefs 75,000-brand study; Muck Rack May 2026):
- Branded web **mentions** correlate 0.664 with AI Overview visibility. Backlinks correlate 0.218. **Mention-building and link-building are two different jobs.**
- 84% of AI citations come from earned media.
- FAQPage rich results were switched off for all sites on 7 May 2026.

**Google Search Console API limits:**
- Search Analytics: 25,000 rows per request, ~50,000 page-keyword pairs per property per day, 2 to 3 day data lag
- URL Inspection: **2,000 per day, 600 per minute, per property.** Hard. Prioritise the top 100 pages by traffic plus recent publishes.
- Use **OAuth per tenant**, never a service account (service accounts require manual per-property user grants and are the #1 cause of mystery 403s)

---

## The killer feature (build this in sprint 2)

Auto-verification of a Search Console property, using the repo:

1. User grants OAuth (`webmasters` + `siteverification` scopes)
2. `sites.add` to create the property
3. Site Verification API `webResource.getToken` returns an HTML file token or meta tag
4. **The repo agent opens a PR that drops the verification meta tag into their root layout**
5. User merges, we call `webResource.insert`, verification completes

No competitor can do this, because no competitor has the repo. This is the demo moment.

---

## Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- Branches: `feat/<slug>`, `fix/<slug>`. Agent-generated: `seo-agent/<finding-id>-<slug>`
- Every new rule needs a unit test with a fixture HTML file before it merges
- Every external API client needs a contract test
- ADRs live in `docs/adr/`, numbered, never edited after acceptance (supersede instead)
- Secrets in `.env`, never committed. `.env.example` stays current.

---

## Testing strategy

- **Unit (Vitest):** the entire rule engine. Pure functions, fixture-driven, 100% deterministic, target 100% coverage. This is the majority of the logic and it involves zero LLM calls.
- **Integration:** GSC client against a mock server, GitHub App against a test repo, Drizzle migrations.
- **Contract tests:** one per external API. They change without warning; we need to know.
- **E2E (Playwright):** connect repo -> run audit -> see finding -> open PR.
- **LLM eval harness:** a golden dataset of ~50 pages with known ground-truth issues. Measure **precision and recall of findings**, **hallucination rate** (findings referencing code that does not exist), and in production, **PR merge rate** and **PR revert rate**. Snapshot-test prompts so a regression fails CI.

---

## Academic context (this is a Quantic MSSE capstone)

Deliverables that must exist in this repo:
- Code, documented, shared with the GitHub account **`quantic-grader`**
- A link to the **deployed version** in the README
- A link to the **agile task board** in the README
- A **design and testing document** covering architecture decisions, patterns used and why, deployment options (cloud vs on-prem) with **cost implications**, and all testing performed with reasons
- Minimum **3 sprints**, weekly scrums, a recorded demo at each sprint end

When asked to write the design and testing document, pull from `docs/adr/` and `docs/architecture.md`.
