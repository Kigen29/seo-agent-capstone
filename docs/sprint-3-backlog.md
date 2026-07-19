# Sprint 3 Backlog: Light the dark axes, and prove it honestly

**Sprint goal:** four of the eight axes are still dark. Sprint 3 measures them, with the same discipline that governs the crawl axes: a parser detects, the model is never the detector, an unmeasured axis says so rather than inventing a number, and every finding carries its falsification. The flagship is **AI visibility**, because it is the axis the whole product is named for, and it is measured the honest way (poll each prompt several times across several days and report a stability score, never a single lucky citation). Where a fix is a repo change, the agent opens a pull request, exactly as in Sprint 2: an `llms.txt` file, a `LocalBusiness` schema block.

This is also the capstone-completing sprint. The Quantic MSSE requires a minimum of three sprints, a recorded demo per sprint, a deployed link and an agile task board in the README, and the design and testing document. All of those close here.

**Sprint demo (the money moment):** on the connected client site from Sprints 1 and 2,

1. Run the AI-visibility poll for the client's target prompts across three days. Show the **citation rate**, the **stability score** (how many of the checks actually cited them), and the **share of voice** against two named competitors. Then show the one thing no dashboard says out loud: "you were cited once out of three, so we are not reporting you as cited; here is the page the answer was built from, and here is what it is missing."
2. Open an **Agent readiness** finding (no `llms.txt`), click Fix with a PR, and watch the agent open a pull request that adds an `llms.txt`, with a body that says plainly it is agent-readiness infrastructure and **not** a Google ranking factor.
3. Show the **Authority** axis leading with brand **mentions**, not backlinks, and a **drafted** digital-PR email that the agent will never send on its own.

---

## What already exists (do not rebuild)

- **The eight-axis scorecard** already reserves and renders all eight axes, and already shows four of them as honestly unmeasured (a dash, a coverage note naming the missing data source). Sprint 3 fills four of those notes with real measurement; the scorecard code does not change.
- **The `Finding` shape, the priority score, the rules registry, and the audit runner.** A new axis produces the same `Finding` shape and merges into the same backlog. AI-visibility and authority findings come from connectors and a poller, not from the crawl rule engine, exactly as the performance axis already does (ADR-0010): the runner merges the streams, the scorecard does not care where a finding came from.
- **The fixer engine, the VCS provider, and the whole write path (Sprint 2).** Adding `llms.txt` or a `LocalBusiness` block is a new fixer behind the existing `Fixer` interface and the existing head/file-injection strategies. No new write machinery.
- **The role-based LLM layer and its budget guard (ADR-0005).** Polling an AI engine asks for a role; the per-tenant budget guard already sits above every paid call. The AI-visibility poller is the first heavy consumer of it.
- **The saga pattern is already named** (architecture.md) for the CWV 28-day window. The AI-visibility multi-day poll is the second saga and reuses the scheduled-job shape from ADR-0006.
- **`SerpProvider` is already named** in the architecture patterns table as a planned Strategy seam. Sprint 3 builds it; it does not invent the seam.

---

## Client setup this sprint depends on (flag early, like the OAuth and GitHub App steps)

- **A SERP / AI-Overview data source.** SerpApi and DataForSEO both sell AI-Overview and SERP data. Both have a small free or trial allowance and then cost money per query. This is the first component in the whole product that is **not free**, so it sits behind a provider interface and a hard per-tenant budget cap, and the free-tier path degrades the axis to unmeasured rather than spending without consent. Flag the key requirement at onboarding.
- **AI-engine access for the poll.** ChatGPT and Perplexity are polled through the existing `@seo/llm` role layer (a `poll` role, or `smart`), so a tenant with no key simply gets an unmeasured AI-visibility axis, never an error.
- **Nothing new from the client for agent readiness or `LocalBusiness` schema**, which are read from the crawl we already run.

---

## Principles that recur across these epics

These constraints apply to every story below. They are stated once here so a story can reference them rather than repeat them, and so an implementer cannot read one epic in isolation and miss them.

- **Deterministic detection, on every axis (ADR-0001).** A parser or an API decides a finding; a model is never the detector. On the AI-visibility axis the engine is the thing being *measured*, like CrUX field data on the performance axis, not the judge of its own citation.
- **Poll many times over days, never once.** Any citation measurement polls a prompt **at least three times across at least three different days** and reports a stability score; a result from a single poll is noise and is not reported as a citation.
- **Paid data is opt-in, capped, and honest when off.** Every paid query passes the per-tenant budget guard before it is made. With no key or no budget, the axis is **unmeasured with a note**, never partial, never a surprise charge, never a zero passed off as a measurement.
- **Draft, never send (rule 6).** The agent drafts outreach; a human sends it.
- **No ranking claims for `llms.txt` (rule 8).** `llms.txt` is agent-readiness infrastructure and is ignored by Google Search; any text implying otherwise is a bug, and a test asserts the disclaimer.

### Definitions used below

- **Citation rate:** across a prompt's polls, the fraction of answers whose cited sources include the client's domain.
- **Stability score:** of the N checks run for a prompt (N >= 3, over >= 3 days), how many cited the client. Reported as "cited in k of N", because ~45% of citations appear in only one of three checks.
- **Share of voice:** the client's citation count as a fraction of all named brands' citations across the same prompts, over the same window.
- **Agent-readiness signals:** the crawl-derived checks for `llms.txt`, a usable accessibility tree and landmark structure, and other agent-facing readiness markers.

---

## Epic 12: AI visibility, measured honestly

### STORY-026: The multi-engine citation poller
**As a** client, **I want** to know whether AI answer engines cite me for the questions my customers ask, **so that** I can see the surface every other tool only talks about.

**Acceptance criteria**
- Given a set of target prompts, when the poller runs, then it queries each configured engine (ChatGPT, Perplexity, and AI Overviews via the SERP provider) and records, for each answer, whether the client's domain is **cited**, and which competitor domains are cited alongside it.
- Citation is detected by a **parser** over the answer and its cited sources (domain match), never by asking a model "were they cited". ADR-0001 holds on this axis too: the engine is the thing being measured, not the detector.
- Every paid query passes through the per-tenant budget guard before it is made, and a tenant with no key or no budget gets an **unmeasured** axis with a note, never a partial or a surprise bill.

**Tasks**
- A `poll` capability on `@seo/llm` (or reuse `smart`) for the chat engines, and a `SerpProvider` interface with a SerpApi adapter for AI Overviews.
- A deterministic citation extractor: given an answer and its source list, does the client domain appear, and which competitors do.

**Falsification:** the poller reports a citation the parser cannot point to in the answer or its sources.

### STORY-027: Stability over a single poll, as a saga
**As a** client, **I want** a citation reported only when it is real, **so that** I am not told I am cited on the strength of one lucky run.

**Acceptance criteria**
- Given a prompt, when it is polled, then it is polled **at least three times across at least three different days**, modelled as a scheduled saga, and the result carries a **stability score** (how many checks cited the client).
- Given a citation that appeared in only one of three checks, then it is **not** reported as a citation; the research is explicit that ~45% of citations appear in only one of three checks, and a single poll is noise.
- Given the report, then it states the **consensus range** the answers agree on and names the client's real numbers against it, and it reports **share of voice** (the client's citation share against named competitors).

**Tasks**
- A scheduled poll saga on the existing GitHub Actions `schedule:` shape, one poll per day for three days, aggregating into a stability score.
- Findings for: not cited where a competitor is; cited unstably; a page whose geographic scope does not match the answer's scope (the strongest predictor of a stable citation).

**Falsification:** a citation from a single poll is reported as a citation, or a stability score is emitted from fewer than three checks.

---

## Epic 13: Agent readiness

### STORY-028: The agent-readiness rules, and the honesty guardrail
**As a** client, **I want** to know whether AI agents can read and act on my site, **so that** I am ready for the agentic web without being sold snake oil.

**Acceptance criteria**
- Given the crawl we already run, when the agent-readiness rules evaluate, then they check for `llms.txt`, a usable accessibility tree / landmark structure, and the agent-facing signals, and each produces the standard `Finding` shape.
- Given any `llms.txt` finding or recommendation, then its text states plainly that `llms.txt` is **agent-readiness infrastructure and is ignored by Google Search** (CLAUDE.md rule 8, and Google's own June 2026 guidance). A recommendation that implies `llms.txt` lifts Google rankings is a bug, and a test asserts the disclaimer is present.

**Tasks**
- Deterministic rules in `packages/rules` reading the crawl: `llms.txt` presence and shape, accessibility-tree landmarks, and the agent-readiness checks.
- A unit test per rule with a fixture, including the rule-8 disclaimer assertion.

**Falsification:** a recommendation claims `llms.txt` improves Google rankings, or the accessibility check fires on a page with a valid landmark structure.

### STORY-029: The `llms.txt` fixer
**As a** client, **I want** the agent to add `llms.txt` for me, **so that** the agent-readiness finding closes the same way a technical one does.

**Acceptance criteria**
- Given the `llms.txt` finding, when Fix with a PR is clicked, then the agent opens a pull request that adds a well-formed `llms.txt` at the site root, generated from the crawl (the site's real sections and key pages), with a PR body carrying the five sections and the rule-8 honesty note.
- Given the file already exists, then no duplicate PR is opened (the idempotency from ADR-0012).

**Tasks**
- A `Fixer` for the agent-readiness rule, writing `llms.txt` via the existing static-file path used by the robots fixer.

**Falsification:** the generated `llms.txt` is malformed, or its PR body claims a Google ranking benefit.

---

## Epic 14: Authority, mentions before links

### STORY-030: Brand-mention tracking, and why it leads
**As a** client, **I want** to track where the web mentions my brand, **so that** I invest in the thing that actually moves AI visibility.

**Acceptance criteria**
- Given the client's brand, when the authority step runs, then it finds web **mentions** (brand name in earned media, via the SERP provider) and reports a mention count and the sources, and the axis **leads with mentions, not backlinks**.
- Given the axis explanation, then it states the research plainly: branded web mentions correlate **0.664** with AI Overview visibility while backlinks correlate **0.218**, so mention-building and link-building are two different jobs, and 84% of AI citations come from earned media.
- Given backlink data is unavailable (no paid backlink index configured), then referring domains are reported as **unmeasured with a note**, never as zero.

**Tasks**
- A mentions query through the `SerpProvider`, and an authority scorer that weights mentions above links per the research.
- Findings for: strong mention footprint but weak on a specific high-intent topic; a competitor out-mentioning the client on the money query.

**Falsification:** the axis presents backlinks as the primary authority signal, or reports zero referring domains when it simply has no backlink source.

### STORY-031: Drafted digital-PR outreach, never sent
**As a** client, **I want** the agent to draft outreach for a mention opportunity, **so that** I can act on it, while I keep control of what goes out under my name.

**Acceptance criteria**
- Given a mention opportunity, when the agent drafts outreach, then it produces a draft email a human reviews and sends; the agent **never sends it** (CLAUDE.md rule 6).
- Given the draft, then it is one `smart` call, schema-validated, grounded on a real, specific fact about the client (the one concrete thing nobody else has), never a mass template.

**Falsification:** the agent sends an email without a human action, or drafts identical boilerplate across opportunities.

---

## Epic 15: Local

### STORY-032: `LocalBusiness` schema and NAP, from the crawl
**As a** local client, **I want** to know my `LocalBusiness` schema and my name/address/phone are correct, **so that** I show up in local and map results.

**Acceptance criteria**
- Given the crawl, when the local rules evaluate, then they check for a valid `LocalBusiness` (or subtype) schema block and for internal NAP consistency across the pages we crawled, each producing the standard `Finding`.
- Given a missing `LocalBusiness` block, then the finding is fixable and the agent opens a PR that adds it, populated from the site's own contact details, through the head-injection path.

**Tasks**
- Deterministic local rules in `packages/rules`, and a `LocalBusiness` schema fixer.

**Falsification:** the local rule fires on a page with valid `LocalBusiness` schema, or the generated block is invalid against schema.org.

### Deferred in Epic 15 (documented, not built): Google Business Profile and the geo-grid

Google Business Profile API access requires an approval process and OAuth scopes beyond this sprint, and geo-grid rank tracking is a per-point paid SERP query that multiplies cost fast. Both are **documented migration triggers**, not silent omissions: NAP across external directories and the geo-grid land when a paying local client justifies the GBP approval and the SERP spend. The local axis is honest about being partially measured until then.

---

## Epic 16: Capstone close-out

### STORY-033: Billing, on the free-tier ethos
**As** the business, **I want** a way to charge, **so that** the plans in the design are real.

**Acceptance criteria**
- Given a plan, when a client subscribes, then billing runs through a provider in test/sandbox mode (Stripe test mode, or M-Pesa Daraja sandbox for the Kenyan market), behind a provider interface so the market's rail is swappable.
- **Stretch, not required for the sprint demo.** If time is short, this defers to a follow-up without blocking the capstone deliverables below.

**Falsification:** a live charge is made in a demo, or the billing rail is hard-coded to one provider.

### STORY-034: The graded deliverables close
**As the** author, **I want** the capstone artefacts complete, **so that** the submission is done.

**Acceptance criteria**
- The README carries a working **deployed link** and a link to the **agile task board**.
- The **design and testing document** is current (it was regenerated at the end of Sprint 2 and updates once more here with the new axes and their tests).
- A **recorded demo** exists for the sprint, showing the money moment above.
- The repository is shared with **`quantic-grader`**.

---

## Architecture decisions to record this sprint (ADRs)

- **ADR-0015: Citation measurement is poll-many-times-over-days, and deterministic.** Poll each prompt at least three times across at least three days, detect citation with a parser over the answer and its sources, never with a model judging itself, and never report a citation from a single poll. The stability score is the honesty, and it is why this axis is trustworthy where a one-shot check is not.
- **ADR-0016: Third-party SERP and AI data behind a `SerpProvider`, under a hard budget cap.** The first paid dependency in the product. A Strategy seam (SerpApi, DataForSEO) so the vendor is swappable, and a per-tenant budget guard so the axis degrades to unmeasured rather than spending without consent. This is where the $0 constraint (ADR-0006) meets a paid necessity, and the resolution is: paid is opt-in, capped, and honest when off.
- **ADR-0017: The authority axis leads with mentions, not links.** Grounded in the 0.664-vs-0.218 research: mention-building and link-building are different jobs, and the axis reflects that rather than the industry's link obsession. Outreach is drafted, never sent (rule 6).
- **ADR-0018: `llms.txt` is agent-readiness infrastructure, never a ranking claim.** Formalises CLAUDE.md rule 8 and Google's own guidance into an accepted decision, so the honesty is a recorded architectural commitment and a tested one, not a footnote.

---

## Out of scope for Sprint 3 (do not build these yet)

- **Buying links, PBN content, mass doorway or location pages.** Hard-refused by policy (CLAUDE.md rule 7). The programmatic-page cap (warn 30, stop 50) already enforces the location-page half at the engine.
- **Auto-sending any outreach.** We draft; humans send (rule 6).
- **Google Business Profile API and the geo-grid**, deferred with triggers above.
- **A paid backlink index (Ahrefs/DataForSEO backlinks) as a default.** Referring domains stay honestly unmeasured until a client justifies the cost; mentions carry the axis in the meantime, which the research says is the better signal anyway.
- **GitLab and Bitbucket providers.** The interface has existed since Sprint 2; the implementations still wait for a client who needs them.
