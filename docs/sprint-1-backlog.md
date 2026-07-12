# Sprint 1 Backlog: The Audit Engine

**Sprint goal:** Point the system at a real site (start with `code5developers.com`, then a live client) and produce a trustworthy eight-axis scorecard with prioritised, falsifiable findings. **No fixes yet. Prove the diagnosis first.**

**Sprint demo:** run an audit live, show the scorecard, show the top 10 findings, show the Search Console quick-wins report.

---

## Epic 0: Foundation

### STORY-001: Monorepo scaffold
**As a** developer, **I want** a working pnpm + Turborepo monorepo, **so that** all packages share types and CI runs once.

**Acceptance criteria**
- Given a clean clone, when I run `pnpm install && pnpm build`, then every package builds with zero TypeScript errors.
- Given a push to any branch, when CI runs, then lint, typecheck, and unit tests all execute.
- Given the repo, when a grader looks at the README, then they find the deployed URL and the task board link.

**Tasks**
- pnpm workspaces + Turborepo config
- TypeScript strict base config, shared via `packages/tsconfig`
- ESLint + Prettier
- GitHub Actions: lint -> typecheck -> test -> build
- Add `quantic-grader` as a collaborator (do this now, do not forget it in month three)

**Falsification:** a fresh clone on a teammate's machine fails to build.

---

### STORY-002: Domain model in `packages/core`
**As a** developer, **I want** the `Finding`, `Audit`, `Site`, `Tenant`, and `Evidence` types defined once, **so that** every package agrees on what a finding is.

**Acceptance criteria**
- Given the `Finding` type, when a finding is constructed without a `falsification` string, then TypeScript rejects it at compile time.
- Given a set of findings, when I call `prioritise()`, then they are sorted by `severity_weight * confidence * impact / effort_cost`.

**Tasks**
- Types per CLAUDE.md domain model
- `prioritise()` pure function + tests
- Zod schemas for runtime validation at package boundaries

**Falsification:** a finding reaches the UI with an empty falsification field.

---

### STORY-003: Postgres schema and multi-tenancy
**As a** platform, **I want** row-level security keyed on `tenant_id`, **so that** one client can never see another client's audit.

**Acceptance criteria**
- Given two tenants, when tenant A queries findings, then zero rows belonging to tenant B are returned, enforced at the database level and not only in application code.

**Tasks**
- Drizzle schema: tenants, users, sites, repos, crawls, pages, findings, prs, snapshots, api_spend
- `tenant_id` on every table, RLS policies
- Migration tooling + a seed script

**Falsification:** a deliberately broken repository query still returns another tenant's rows.

---

## Epic 1: The crawler

### STORY-004: Playwright crawler
**As an** auditor, **I want** to crawl up to 500 pages of a site, **so that** I have the raw material for every rule.

**Acceptance criteria**
- Given a URL, when I crawl, then I get per page: status, headers, redirect chain, raw HTML, rendered DOM, text, headings, links, images, canonical, meta robots, JSON-LD, hreflang.
- Given a crash at page 47, when I restart, then the crawl resumes at page 48.
- Given `robots.txt` disallowing a path, when I crawl, then that path is not fetched.

**Tasks**
- Playwright driver with configurable concurrency and delay
- Pre-JS and post-JS HTML capture (to detect CSR-only pages)
- Resumable state persistence
- Identifiable user agent with a contact URL
- Artefact storage (HTML + screenshot)

**Falsification:** the crawler hammers a site, gets blocked, or misses pages a browser can see.

---

### STORY-005: Link graph and site structure
**As an** auditor, **I want** the internal link graph, **so that** I can find orphans, deep pages, and internal linking opportunities.

**Acceptance criteria**
- Given a crawl, when I build the graph, then I can compute click depth from the homepage, internal PageRank, and the set of orphan pages.
- Given a page in the sitemap but with zero internal inbound links, then it is flagged as an orphan.

**Tasks**
- Adjacency list from the crawl
- BFS click depth
- Iterative internal PageRank
- Orphan and near-orphan detection (depth > 3)

---

### STORY-006: robots.txt and sitemap parsing (including AI crawlers)
**As an** auditor, **I want** to evaluate robots.txt per user agent across all five AI crawler categories, **so that** I can catch the most damaging misconfiguration on the web right now.

**Acceptance criteria**
- Given a robots.txt that disallows `OAI-SearchBot` or `PerplexityBot`, then a **critical** finding is raised: the site has deleted itself from ChatGPT and Perplexity answers.
- Given a Cloudflare-managed robots.txt using Content Signals syntax, then it parses without error.
- Given a sitemap index, then all child sitemaps are fetched and their URLs cross-checked against the crawl for 404s, redirects, and noindex.

**Tasks**
- RFC 9309 compliant parser
- AI user agent taxonomy: training (`GPTBot`, `ClaudeBot`, `CCBot`), search/retrieval (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`), user-triggered (`ChatGPT-User`, `Perplexity-User`, `Google-Agent`), opt-out tokens (`Google-Extended`, `Applebot-Extended`)
- Content Signals directive parsing (`search=`, `ai-input=`, `ai-train=`, `use=`)
- Sitemap and sitemap-index parsing

**Falsification:** we tell a site their AI crawler posture is fine when `OAI-SearchBot` is actually blocked.

---

## Epic 2: The rule engine

### STORY-007: Rule engine core + first 20 technical rules
**As an** auditor, **I want** ~20 deterministic `TECH-*` rules, **so that** the crawl produces findings.

**Acceptance criteria**
- Given a crawl, when the engine runs, then every rule executes as a pure function with zero LLM calls.
- Given any rule, when it produces a finding, then `falsification` is non-empty.
- Given the test suite, then every rule has at least one triggering fixture and one clean fixture.

**Rules to ship (minimum)**
`TECH-001` robots.txt blocks a critical path ·
`TECH-002` AI search crawler blocked (critical) ·
`TECH-003` no XML sitemap or not referenced in robots.txt ·
`TECH-004` sitemap contains non-200 or non-canonical URLs ·
`TECH-005` unintentional noindex ·
`TECH-006` missing canonical ·
`TECH-007` canonical points to a non-200 ·
`TECH-008` redirect chain longer than 1 hop ·
`TECH-009` redirect loop ·
`TECH-010` broken internal link (4xx/5xx) ·
`TECH-011` duplicate title across URLs ·
`TECH-012` duplicate content cluster (SimHash) ·
`TECH-013` orphan page ·
`TECH-014` click depth greater than 3 ·
`TECH-015` mixed content on HTTPS ·
`TECH-016` hreflang missing return tag ·
`TECH-017` soft 404 (200 status, not-found content) ·
`TECH-018` page renders empty without JavaScript (CSR-only) ·
`TECH-019` missing or duplicate H1 ·
`TECH-020` heading hierarchy skips a level

**Falsification:** a rule fires on a page that is actually fine (false positive) in the golden dataset.

---

### STORY-008: The eight-axis scorecard
**As a** client, **I want** eight independent scores, **so that** I know which surface is broken.

**Acceptance criteria**
- Given a set of findings, when the scorecard renders, then it shows crawl health, performance, content, structure, authority, local, AI visibility, and agent readiness as separate 0 to 100 scores.
- Given any request for a single overall score, then the product refuses and explains why. **We never ship one number.**

---

## Epic 3: Connectors

### STORY-009: Google Search Console OAuth + Search Analytics
**As a** client, **I want** to connect my Search Console with one click, **so that** the agent sees my real performance data.

**Acceptance criteria**
- Given the connect button, when I authorise, then a refresh token is stored **encrypted**, scoped to my tenant, and no password is ever requested.
- Given a connected property, when the agent pulls Search Analytics, then it paginates past 25,000 rows and respects the 2 to 3 day data lag.
- Given a `[query, page]` request, then the client instead pulls dimensions **separately and joins client-side**, to avoid Google's low-volume anonymisation.
- Given a 429, then the client backs off exponentially.

**Tasks**
- OAuth 2.0 flow, scopes `webmasters` + `siteverification`
- Encrypted token storage + rotation
- `sites.list`, `searchanalytics.query` with pagination
- Per-tenant quota tracking

**Falsification:** we report a client's keyword count and it is materially lower than what GSC's own UI shows, because we hit the row cap silently.

---

### STORY-010: The quick-wins report
**As a** client, **I want** the pages that are one nudge from the fold, **so that** I know where the fastest money is.

**Acceptance criteria**
- Given Search Analytics data, when the report runs, then it returns queries at **position 4 to 20**, with **impressions >= 50**, and **CTR < 5%**, sorted by impression volume.
- Given two of my pages competing for the same query, then a **cannibalisation** finding is raised.

*(This is the single highest-ROI report in all of SEO and it is trivial to compute. Ship it early, it will sell the product on its own.)*

---

### STORY-011: PageSpeed Insights + CrUX (Core Web Vitals)
**As a** client, **I want** my real Core Web Vitals, **so that** I know if I am actually failing.

**Acceptance criteria**
- Given a URL, when we assess CWV, then we use **CrUX field data at p75**, and we label Lighthouse output explicitly as **lab data that does not determine ranking**.
- Given a passing Lighthouse score and a failing CrUX score, then the UI explains that this is normal and not a bug.
- Given a metric in the poor band, then it is prioritised above metrics in the needs-improvement band.
- Given any CWV fix recommendation, then the UI states that CrUX updates on a **28-day rolling window** and results will not appear immediately.

**Thresholds (do not get these wrong):** LCP <= 2.5s, INP <= 200ms, CLS <= 0.1, at p75.

---

## Epic 4: Web app

### STORY-012: Dashboard, auth, findings inbox
**As a** client, **I want** to log in, add a site, run an audit, and read my findings, **so that** the product is usable by a non-engineer.

**Acceptance criteria**
- Given a finding, when I open it, then I see the evidence, the affected URLs, the expected impact, the effort, and the **falsification condition** in plain language.
- Given a running audit, then I see live progress, not a spinner.

---

## Out of scope for sprint 1 (do not build these yet)
- Any repo write access or PR generation (sprint 2)
- AI visibility polling (sprint 3)
- Backlinks, digital PR, local SEO (sprint 3)
- Billing, M-Pesa (sprint 3, if time)
