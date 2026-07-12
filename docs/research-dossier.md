# SEO Agent: Deep Research Dossier

**Prepared for:** Emmanuel, Code 5 Developers / Quantic MSSE Capstone
**Date:** 12 July 2026
**Scope:** Everything you need to know about SEO, AEO, GEO and LLMO to build an autonomous SEO agent that connects to a client's repo, audits their technical and off-site presence, and ships fixes.

---

## 0. The thesis, in one page

The single most important finding from this research, and the one that should shape your whole product:

> **Every tool in the AI-visibility category is a dashboard. They measure the problem. None of them fix it.**

That is not my opinion; it is the recurring, load-bearing complaint in every 2026 buyer's guide for Profound, Peec AI, Otterly, Scrunch and the rest. Buyers pay $29 to $500+ per month to be told, with beautiful charts, that ChatGPT recommends their competitor. Then they have to go and do the content restructuring, schema work, entity cleanup and off-site PR themselves.

Meanwhile, on the traditional-SEO side, the crawlers (Screaming Frog, Ahrefs Site Audit, Semrush Site Audit) produce a list of 400 issues and hand it to a marketer who cannot write a `next.config.js` change, so the list rots in a spreadsheet.

**Your wedge is the gap between those two.** You are a software engineer building a tool for a market where nobody can code. An agent with write access to the repository can close the loop:

```
crawl → diagnose → prioritise → open a PR that fixes it → verify the fix in production → prove the movement in GSC
```

Ahrefs has already validated the primitive: their "Fix with Agent A" feature let a dev give an agent temporary GitHub access; it opened a PR fixing a broken-image issue, and re-crawled to confirm resolution after merge. That is a feature inside a $200/month suite. Nobody has built the whole product around it.

The name for what you're building already exists in the market's mind: **an SEO engineer, not an SEO dashboard.**

---

## Part 1: What actually changed in search (2024 → mid-2026)

### 1.1 Google has formally collapsed GEO and AEO back into SEO

On **15 May 2026** Google published its first official guide: *"Optimizing your website for generative AI features on Google Search"* (Search Central, under a new "Generative AI fundamentals" section). It is the single most important primary source for your project.

Key positions, quoted in substance:

- **"From Google Search's perspective, optimizing for generative AI search is optimizing for the search experience, and thus still SEO."** Google explicitly names AEO and GEO and folds them into SEO.
- AI Overviews and AI Mode are **built on the same core ranking and quality systems** as classic Search. They are not a separate index.
- Two mechanisms power them:
  - **RAG (retrieval-augmented generation / "grounding"):** the model retrieves pages from Google's existing index, then synthesises. **If your page is not indexed and eligible to rank, it cannot be retrieved, and cannot be cited.**
  - **Query fan-out:** one user query spawns concurrent sub-queries. Google's own example: *"how to fix a lawn that's full of weeds"* fans out into *"best herbicides for lawns"*, *"remove weeds without chemicals"*, *"how to prevent weeds in lawn"*. Consequence: your page can be cited for queries you never targeted, provided the topic coverage is genuinely deep.
- **Mythbusting section.** Google names tactics site owners can *ignore* for Google Search and its AI features:
  - `llms.txt` files (crawled like any other text file; no special pathway)
  - content chunking (Google can extract passages from multi-topic pages)
  - AI-specific rewriting for long-tail variations
  - special schema or Markdown versions of pages
  - inauthentic "brand mentions" seeded to influence AI answers (spam systems apply to AI features too)
- **Structured data is not required for AI features.** Keep it for rich results eligibility, not as an AEO lever.
- The **single biggest long-term factor** Google names is **non-commodity content**. Their own contrast:
  - Commodity (bad): *"7 Tips for First-Time Homebuyers"*
  - Non-commodity (good): *"Why We Waived the Inspection & Saved Money: A Look Inside the Sewer Line"*
- On **15 June 2026** Google added a subsection explicitly clarifying llms.txt after community confusion: maintaining the file is fine, but it *neither helps nor harms* Google visibility.
- New **agentic experiences** section: browser agents may read your site via screenshots, the rendered DOM, and the **accessibility tree**. Emerging protocols named: **Universal Commerce Protocol (UCP)** and **WebMCP**.

**Product implication:** your agent must never sell "GEO" as a mystical separate discipline for Google. It should sell it honestly: *for Google, GEO is SEO plus originality; for ChatGPT/Perplexity/Claude, there is a genuinely separate off-site citation game.* That honesty is a differentiator in a market drowning in acronym-driven upsells.

### 1.2 Ranking and citation have decoupled (this is the real news)

- Ahrefs analysed roughly **4 million AI Overview URLs across 863,000 keywords**: only about **38% of cited pages also rank in the top 10** for the same query. Roughly a third come from outside the top 100.
- BrightEdge (2026) puts it harder: only about **17%** of AI Overview sources also rank organic top 10.
- An April 2026 analysis of 1,000 AI Overviews found the **top 1% of cited domains capture nearly half of all citations**. Citation concentrates hard.
- Ahrefs' click-through research shows AI Overviews can **cut clicks to top-ranking pages by more than half**.

So you now have **two contests**: the ranking contest and the citation contest. A serious agent must score and report on both, separately.

### 1.3 The `llms.txt` situation (do not get this wrong in your pitch)

This is the clearest "vendor bullshit detector" in the industry right now, and getting it right will make your tool credible.

| Claim | Reality (mid-2026) |
|---|---|
| llms.txt improves Google rankings | **False.** Gary Illyes said no in July 2025; John Mueller compared it to the keywords meta tag; Google's June 2026 docs say Search ignores it. |
| llms.txt improves AI Overview / AI Mode citation | **False.** Same documentation. |
| llms.txt improves ChatGPT/Perplexity citation | **Unproven.** SE Ranking modelled ~300,000 domains (10.13% adoption) and found **zero measurable effect** on AI citations; removing the variable *improved* their model's accuracy. Ahrefs found **97% of 137,210 tracked domains saw zero requests** to the file in May 2026. |
| llms.txt is useless | **Also false.** Coding and browsing agents (Cursor, Claude Code, GitHub Copilot, Windsurf, Cline, Aider) routinely fetch `/llms.txt` and `/llms-full.txt`. Anthropic recommends it in its "Writing for Agents" guidance; OpenAI uses it for the Agents SDK. **Chrome Lighthouse 13.3 (7 May 2026)** promoted an **"Agentic Browsing"** audit category into the default config, and it checks for llms.txt. |

**Correct product position:** llms.txt is *agent-readiness infrastructure*, not a ranking lever. Ship it for docs sites, developer products, and anyone whose buyers use AI coding tools. Cost: half a day. Never bill it as GEO.

### 1.4 The AI crawler layer is now a real, checkable technical surface

There are **five functionally distinct categories** of AI user agent, and one `Disallow: /` cannot make all the decisions correctly:

1. **Training crawlers** — `GPTBot`, `ClaudeBot`, `CCBot`, `anthropic-ai`, `Meta-ExternalAgent`, `Bytespider`
2. **Search / retrieval crawlers** — `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot` (these are the ones that make you *citable*)
3. **User-triggered fetchers** — `ChatGPT-User`, `Claude-User`, `Perplexity-User`, `Google-Agent`, `Google-NotebookLM`, `Gemini-Deep-Research` (often ignore robots.txt by design)
4. **Opt-out tokens** — `Google-Extended`, `Applebot-Extended` (block AI training without touching Search ranking)
5. **Undeclared / stealth crawlers** — a detection problem, not a robots.txt problem. Cloudflare documented Perplexity rotating user agents, IPs and ASNs in August 2025.

**The single most common, most damaging misconfiguration your agent should catch:** a site that copy-pasted a 2023 "block AI" robots.txt and accidentally blocked `OAI-SearchBot` and `PerplexityBot`, thereby deleting itself from ChatGPT and Perplexity answers, while `Bytespider` (which ignores the file anyway) still hammers the origin.

**Time-critical, and a brilliant hook for launching your product:**
On **1 July 2026** Cloudflare launched three-way AI traffic management (**Search / Agent / Training**) for all customers including the free tier. On **15 September 2026** new defaults kick in automatically for new domains and un-reviewed free-tier customers. Multi-purpose crawlers (Googlebot, Bingbot, Applebot) will be **blocked by the most restrictive applicable rule**, so a site that blocks "Training" can accidentally block Googlebot. Cloudflare also ships a managed `robots.txt` using the **Content Signals** syntax (`search=yes, ai-train=no, use=reference`).

An automated "Are you about to accidentally block Googlebot on 15 September?" scanner is a *free lead magnet with a deadline*. That is the kind of thing that gets shared.

### 1.5 Search Console is no longer just for websites (July 2026)

On **7 July 2026**, five days before this document was written, Google shipped **Platform Properties** in Search Console: a new property type that verifies an **Instagram, TikTok, X or YouTube account** (not a domain) and reports how those posts perform in **Google Search and Discover**, with query-level data, clicks, impressions, Performance + Insights + Achievements reports.

This is the first Search Console property you can verify **without owning a domain**. It is rolling out gradually.

**This lands directly on the "look at their social media presence" requirement in your brief.** Before this, social-vs-search attribution was guesswork. Now your agent can:
- prompt the user to connect their IG/TikTok/X/YouTube as platform properties,
- pull the queries their social posts already rank for,
- and cross-reference: *"Your TikTok ranks for 'how to unclog a drain Nairobi' but you have no page on your own site for it. Here's the brief."*

That is a genuinely novel, defensible feature. Nobody has shipped it yet because the API surface is five days old.

---

## Part 2: The complete optimisation surface your agent must encode

This is the knowledge base. Treat each subsection as a **skill file** for a specialist sub-agent (more on architecture in Part 5).

### A. Crawlability and indexation (the gate; nothing else matters if this fails)

| Check | Signal | How to detect |
|---|---|---|
| robots.txt exists, parses, does not block critical paths | Blocking `/`, `/blog`, CSS/JS | Fetch + parse `/robots.txt` |
| AI crawler posture (see 1.4) | Search bots blocked | Parse robots.txt per user agent |
| XML sitemap exists, is referenced in robots.txt, is fresh, contains only 200-status canonical URLs | Orphan/404/redirect URLs in sitemap | Fetch, parse, cross-check against crawl |
| `noindex` on pages that should be indexed | meta robots, X-Robots-Tag header | Crawl + header inspection |
| Canonical tags: self-referencing, absolute, consistent | Canonical pointing to a redirect or non-200 | Crawl |
| Duplicate content clusters | Same title/H1/content hash across URLs | SimHash / MinHash across crawl |
| Orphan pages (no internal inbound links) | In sitemap but not in link graph | Graph analysis |
| Redirect chains and loops | >1 hop | Crawl with redirect following |
| 4xx / 5xx internal links | Broken links | Async link checker |
| HTTPS, HSTS, mixed content | Insecure resources | Response inspection |
| `hreflang` correctness (return tags, x-default) | Missing reciprocal tags | Crawl + cross-reference |
| Pagination and faceted-navigation traps | Infinite parameter combinations | URL pattern analysis |
| Crawl budget waste | Googlebot hitting parameter URLs / 404s | **Server log analysis** (see below) |

**Crawl budget / log analysis** is the highest-value technical work almost nobody does, because it needs raw access logs. If you can accept an nginx/Apache log upload (or, better, tap into their infrastructure since you already have repo access), you can verify:
- which pages Googlebot actually crawls and how often,
- whether AI crawlers are hitting them at all,
- bot verification via reverse DNS (never trust the user-agent string alone),
- stale pages Googlebot has forgotten.

### B. Rendering (the thing most React/Next.js sites get wrong)

Google now evaluates pages through **three surfaces**: the visual rendering (screenshot), the **rendered DOM after JS execution**, and the **accessibility tree** (ARIA roles, labels, landmarks). If your client's site is a soup of unlabelled `<div>`s, Google's AI agents struggle to parse it.

Checks:
- Does the page render meaningful content **without JavaScript**? (Fetch with JS off, compare text ratio.)
- Is the site CSR-only when it should be SSR/SSG/ISR? (Framework detection from the repo makes this trivial for you and impossible for competitors.)
- Semantic HTML: one `<h1>`, logical heading hierarchy, `<main>`, `<nav>`, `<article>`.
- Accessibility tree quality (Lighthouse accessibility + the new Agentic Browsing category).
- Soft 404s (200 status, "not found" content).

### C. Core Web Vitals (field data, not lab data)

**Thresholds (unchanged since INP replaced FID on 12 March 2024), measured at the 75th percentile of real Chrome users over a rolling 28-day window:**

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤ 2.5s | 2.5s to 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | ≤ 200ms | 200ms to 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1 | 0.1 to 0.25 | > 0.25 |

Critical nuances your agent must not get wrong:
- **Lighthouse does not measure Core Web Vitals.** Lighthouse is lab data. Google ranks on **field data from CrUX**. A green Lighthouse score with a red Search Console report is normal, not a bug. Lighthouse cannot measure INP at all (it uses **Total Blocking Time** as a proxy).
- Roughly **43 to 48% of mobile origins pass all three.** Individual mobile pass rates: LCP ~62%, INP ~77%, CLS ~81%. **LCP is the most-failed metric; INP is the hardest to fix.**
- CrUX is a **28-day rolling average**, so a fix does not show up for weeks. Your agent must tell users this, or they will revert good changes out of impatience.
- Fix priority: whatever is in the *poor* band first → then INP (hardest) → then LCP (highest commercial impact) → then CLS (easiest). Never optimise a green metric.
- Set alarms at 80% of threshold: INP > 160ms, LCP > 2.0s, CLS > 0.08.

**Data sources:** CrUX API (per-page or per-origin, filterable by form factor), CrUX on BigQuery (origin-level history), PageSpeed Insights API (field + lab in one call), Search Console CWV report.

Because you have the **repo**, your fixes are concrete and shippable rather than advisory:
- LCP: `fetchpriority="high"` on the hero image, remove `loading="lazy"` from it, convert to AVIF/WebP, preload critical fonts, `font-display: swap`, inline critical CSS.
- CLS: explicit `width`/`height` on `<img>`, reserved containers for ads/embeds, avoid injecting DOM above existing content.
- INP: break long tasks, `scheduler.yield()`, defer third-party scripts, shrink the hydration payload, reduce DOM depth.

Every one of those is a diff. That is the whole point of your product.

### D. On-page and semantic

- Title tag: unique, ~60 char display threshold (a *truncation* risk, not a ranking penalty; be honest about this).
- Meta description: unique, ~155 chars, written for CTR not ranking (not a ranking factor).
- H1 present and unique; heading hierarchy not skipping levels.
- **Keyword cannibalisation:** two of your pages competing for the same query. Detect it from GSC by finding queries where multiple pages of the same site take impressions, splitting the CTR. This is invisible in a spreadsheet and very valuable.
- **Quick wins:** GSC queries at **position 4 to 20**, with **impressions ≥ 50**, and **CTR < 5%**. These are pages one nudge away from the fold. This single query is the highest-ROI report in all of SEO and it is trivial to compute from the Search Analytics API.
- Image alt text, filename hygiene, `srcset`.
- Internal anchor text distribution (over-optimised exact-match anchors are a risk signal).

### E. Structured data (schema.org)

JSON-LD is Google's stated preference. Types worth detecting, validating and generating:

`Organization`, `LocalBusiness`, `WebSite` (+ `SearchAction`), `WebPage`, `BreadcrumbList`, `Article` / `BlogPosting` / `NewsArticle`, `Product` / `ProductGroup` / `Offer`, `Review` / `AggregateRating`, `Person`, `ProfilePage`, `ContactPage`, `VideoObject`, `ImageObject`, `Event`, `JobPosting`, `Course`, `FAQPage`, `HowTo`, `SoftwareSourceCode`.

Two important 2026 realities:
- **FAQPage rich results were switched off for all sites on 7 May 2026.** The markup still has value as an entity/AI signal, but do not promise rich results from it.
- Structured data is **not** an AEO lever. HeyTony's controlled study found that pages that ranked but were *never cited* had good structure at almost exactly the same rate as cited pages. **A trait shared by winners and losers is not a winning trait.** Schema is table stakes for ranking, not a citation edge.

### F. Site architecture and internal linking

Internal linking is described across the industry as the **highest-impact and most-neglected** SEO activity, because doing it well is tedious. That makes it perfect for an agent.

- Build the internal link graph from the crawl.
- Compute internal PageRank; find high-authority pages with few outbound internal links.
- Find "orphan" and "near-orphan" pages (click depth > 3 from home).
- For each target page, score candidate source pages by topical relevance (embeddings), and **deterministically check the link does not already exist** before recommending it.
- Output: a diff adding contextual internal links with sensible anchors.

### G. Off-page: backlinks, digital PR and brand mentions

The 2026 consensus, backed by the numbers:

- Backlinks remain roughly the **second-strongest ranking signal** after content relevance, but quality now dominates volume absolutely.
- **48.6% of SEO professionals now rate digital PR the single most effective link tactic** (Aira / Editorial.link, State of Link Building 2026), roughly triple guest posting (~16%).
- The average digital PR campaign earns links from ~**42 unique domains**, with 20%+ from DR 70 to 79 sites. Reported average ROI ~312%.
- A high-quality link costs **$508 to $1,000+** on average (BuzzStream). **94% of online content earns zero external backlinks.**
- **The finding that should reshape your product:** an Ahrefs study of **75,000 brands** found **branded web mentions correlate 0.664 with AI Overview visibility, versus 0.218 for traditional backlink metrics.** That is roughly a 3x advantage for *unlinked brand mentions* over links, for AI visibility.
- Muck Rack (May 2026): **84% of all AI citations come from earned media**; paid/advertorial content accounts for **0.3%**.

So the off-page module has two distinct jobs:
1. **Link acquisition** (classic SEO): competitor backlink gap analysis, broken-link building, resource-page outreach, unlinked-mention reclamation, digital PR angles, HARO successors (**Connectively**, **Qwoted**, **Featured.com**; the original HARO shut down November 2024).
2. **Mention acquisition** (AI visibility): getting the brand named on the third-party surfaces AI engines actually read (Reddit, YouTube, Wikipedia, industry roundups, editorial coverage). This is *not* the same job, and almost no tool separates them.

Toxic-link / risk detection matters too: no single tactic should exceed 30 to 40% of link acquisition; anchor-text over-optimisation is cited as the leading cause of 2026 ranking drops.

**Hard boundary for your agent:** it can *research and draft* outreach, find prospects, score them, write the pitch. It must **not** auto-send outreach at scale (spam, deliverability, reputational suicide) and must **never** buy links or generate PBN content. Bake that constraint into the system prompt and the product copy. "We will not do the thing that gets you penalised" is a selling point.

### H. Local SEO

- **Google Business Profile** is often the highest-leverage asset for a local business (map pack drives more clicks than the website for many). Optimise: categories, hours, attributes, services, products, photos, posts (HeyTony posts 3x/week), Q&A, review responses.
- **NAP consistency** (Name, Address, Phone) across citations and directories.
- Geo-grid rank tracking (rankings vary by neighbourhood, so a single "rank" number is a lie for local).
- `LocalBusiness` schema with geo coordinates, `openingHours`, `areaServed`.
- **Doorway-page danger:** mass-generated city pages are a spam violation. Enforce a hard cap (a good open-source implementation warns at 30 pages and hard-stops at 50).
- Citation building is a **once or twice a year** job, not a monthly retainer item. HeyTony explicitly calls out agencies who bill monthly for it as selling "optimization theatre."

### I. Social and platform presence

- **Search Console Platform Properties** (see 1.5): connect IG / TikTok / X / YouTube, pull query-level Search + Discover data.
- YouTube as a search engine in its own right (titles, descriptions, chapters, transcripts).
- Social profiles as **entity signals** (`sameAs` in Organization schema, consistent naming, consistent bio/description across platforms).
- TikTok as a functional search engine for how-to and local queries.
- Detection of profile/brand-name inconsistency across platforms, which fragments the entity.

### J. AI visibility: GEO / AEO / LLMO

**The academic foundation.** *"GEO: Generative Engine Optimization"* (Aggarwal, Murahari, Rajpurohit, Kalyan, Narasimhan, Deshpande; Princeton / Georgia Tech / Allen Institute / IIT Delhi, arXiv 2311.09735, published at **KDD 2024**). It introduced:
- **GEO-bench**: 10,000 queries across 9 domains.
- Novel **visibility metrics**, notably **Position-Adjusted Word Count** and **Subjective Impression**, replacing rank position (which is meaningless in a generated answer).
- Nine optimisation methods, evaluated against a baseline. The winners were **Statistics Addition**, **Cite Sources**, and **Quotation Addition**, giving **up to 30 to 40% visibility improvement**. Classic **keyword stuffing performed *worse* than baseline.**
- Effect sizes vary by domain, so domain-specific optimisation is necessary.
- Public repo: `github.com/GEO-optim/GEO`

**The industry reality check.** HeyTony ran the study everyone else skipped, and it is the most rigorous public GEO work I found. Methodology worth stealing wholesale:
- 100 queries, 10 industries, checked **3 separate times over several days** from Toronto (June 2026).
- **1,067 cited pages** collected, plus, crucially, a **163-page control group**: pages that ranked on page one but were *never* cited in any check.

Findings:

1. **45.3% of AI Overview citations appeared only once across three checks.** Only **31.9% appeared in all three.** *Any AI-visibility report built on a single snapshot is roughly a coin flip.*
2. **Geographic scope matching** was the strongest predictor of stable citation (+~14 percentage points over controls). A page scoped to a city cannot support a province-level AI answer. The AI localises later, in follow-up conversation.
3. **Consensus agreement:** the AI generates the answer first, then selects pages that *support the sentences it already wrote*. Pages whose figures matched or encompassed the AI's figures were ~12 points more likely to be cited. **Disagreeing with the consensus, even when you are right, makes you unquotable.** The move: state the consensus range plainly, then layer your real expert numbers underneath it.
4. **Big-brand saturation:** where page one is mostly smaller sites, SMBs took **77%** of stable citations. Where big brands wall it off, they took **76%**. Winnability is mostly decided before you write a word. Five-minute check: count big-brand results on page one; if more than 7 of 10, pick a more specific query.
5. **Most AI Overviews are built from ONE page.** A single "skeleton" page supplies most of the answer; other citations are garnish, and the garnish citations are the unstable ones. **The target is not "get a citation." It is "be the page the answer is built from."** Your money page needs the headline range, the tiers, the drivers, and the main caveat, all in one place, so the AI never needs a second source.
6. **What did NOT matter** (once compared against controls): heavy formatting / answer boxes / FAQ blocks (~85% of page-one results have them already), fact density (cited pages had slightly *fewer* structured facts), and question-format matching (slightly *worse* than controls).
7. **The most usable tip in the study:** put **one specific, true, concrete fact that nobody else has** into everything you publish. Your own job data, your own timelines, your own counts. Big brands cannot copy your data, and a single distinctive fact can crack overviews you would otherwise never win.

Also: **snippet position matters.** A CXL analysis of 100 AI Overview citations found **55% of cited snippets came from the top 30% of the source page.** Keep the headline answer near the top.

**LLM-visibility measurement design implications for your agent:**
- Never report a citation from a single check. **Poll each prompt at least 3 times across different days**, and report a *stability score*, not a binary.
- Track per-engine: ChatGPT / OpenAI search, Perplexity, Google AI Overviews, Google AI Mode, Gemini, Claude, Copilot, Grok.
- Metrics: brand mention rate, citation rate, share of voice vs named competitors, sentiment, prominence/position within the answer, **and which source domains the engine actually cited** (this tells you where to go do PR).
- Content freshness matters: Kevin Indig's research indicates content under 30 days old gets ~**3.2x more citations**.

### K. Agent-readiness (the frontier; ship this and you are 12 months ahead)

**Lighthouse 13.3** (7 May 2026) promoted **"Agentic Browsing"** from experimental into the default config. It now runs in standard Lighthouse, PageSpeed Insights and Chrome DevTools, with no opt-in. It checks four areas including:
- **llms.txt** presence, accessibility and spec compliance (H1 title, optional blockquote summary, H2-sectioned links)
- **WebMCP** integration
- agent accessibility
- layout stability

Plus **UCP (Universal Commerce Protocol)**, named in Google's own guide as the emerging standard letting Search agents transact.

Nobody is auditing for this. A "Is your site ready for AI agents to *use* it, not just read it?" score is a genuinely new product surface, and it maps perfectly to your existing agent-building interest.

### L. Measurement and attribution

- **Google Search Console** is the source of truth for organic. First-party, free, honest.
- **GA4** for post-click behaviour, and increasingly for **LLM referral traffic** (segment by referrer: `chatgpt.com`, `perplexity.ai`, `claude.ai`, `gemini.google.com`, `copilot.microsoft.com`).
- **Server logs** for crawler behaviour (the only place you see whether `OAI-SearchBot` is even visiting).
- **Looker Studio** for client-facing dashboards (this is exactly what HeyTony does; a live dashboard beats a monthly PDF).
- Warning to encode: **SparkToro research shows significant variability in AI brand recommendations even for identical prompts.** Prioritise **trends over snapshots**, always.

---

## Part 3: HeyTony teardown

Matt Diamante's agency (Hamilton, Ontario; ~5-star across 111 Google reviews; clients including Royal Caribbean Arabia; ~380K Instagram followers on `@heytony.agency`). This is your closest philosophical model, and you should study the *business*, not just the SEO.

### Their stated process

1. **Baseline report** first: keyword rankings, clicks, traffic, bounce rate. Measure before you touch anything.
2. Analyse current optimisation; produce a **low-hanging-fruit list** to kick off the campaign.
3. **Competitor deep dive**: their site, keyword strategy, optimisation efforts. Find what they do well and where the holes are.
4. **Keyword research**, biased toward **long-tail, lower-difficulty** terms (long-tail is ~80% of Google searches).
5. Build an **SEO roadmap** specific to the business.
6. **Monthly reporting** (they argue month-over-month is the only honest cadence, because daily/weekly data is algorithmic noise), plus **weekly client updates** on what was worked on.

### Their tool stack (this is your feature checklist)

| Tool | Job |
|---|---|
| **Google Search Console** | "Non-negotiable." First thing checked. Indexation, which keywords/pages are climbing, where to double down. |
| **Semrush** | Keyword research, competitor analysis, backlink audits, rank tracking. |
| **ChatGPT** | Drafting, ideation, learning the client's industry fast. |
| **Looker Studio** | Live client dashboards fed from GSC + GA4. |
| **Google Business Profile** | Local map pack; posts 3x/week. |
| **BrightLocal** | Geo-grid local rank heat maps, citation tracking, GBP scheduling. |
| **Google Analytics** | Post-click behaviour + **tracking how much traffic comes from LLMs**. |

### Their in-house tools (this is the actual insight)

They built four products, and they gave them away free as lead magnets:

- **`pageaudit.com`** — free page audit
- **`heytony.ca/content-analyzer`** — free content analyzer
- **`audit.heytony.ca`** — site audit tool: health score, missing meta tags, weak titles, orphan pages, thin content, at scale
- **`watchdog.heytony.ca`** — **competitor monitoring**: watches competitors' sites and flags *changes*. New blog post, swapped headline, updated pricing, removed service page. They claim nothing else does this.
- **`aireadinesschecker.com`** — free AI readiness checker (promoted at the end of their AI Overview study)

**Steal this pattern.** The free tool is the funnel. The audit is the pitch. And **Watchdog is the single best product idea in their whole stack**: change-detection on competitors is cheap to build (diff the crawl weekly), genuinely hard to do manually, and creates a reason to open your app every week.

### Their philosophy (worth adopting verbatim)

- *"AEO. AIO. GEO. LLMO. It's all just SEO. If an agency keeps inventing new acronyms to make their service sound complex or cutting-edge, ask yourself who that benefits."*
- Nobody can guarantee rankings. Agencies that do either don't understand SEO or are lying.
- They once lost a lead to an agency promising **100 backlinks/month** while HeyTony recommended **4 high-quality ones** for the same price. The client chose quantity. HeyTony warned them they were risking the site.
- **"Optimization theatre"** is their name for tweaking a heading and calling it a deliverable.
- *"Good SEO feels boring before it feels exciting."* Expect no obvious results in the first 90 days.
- *"Tools don't win SEO. Strategy does."*

That last one is the honest counterweight to your entire product thesis, and you should engage with it head-on in your capstone. Your answer: **the agent doesn't replace strategy, it deletes the tedium**, and it can *execute* the strategy in code, which no dashboard can.

---

## Part 4: Competitive landscape and the gap

### 4.1 AI visibility platforms (the new money)

The category raised **$300M+ between summer 2025 and spring 2026**. Search volume for "AI visibility tools" is up ~1,900% YoY as of July 2026.

| Tool | Entry price | Notes |
|---|---|---|
| **Profound** | from $99/mo (realistically $399 to $499+); enterprise $2,000 to $5,000/mo | $155M raised, **$1B valuation** (Feb 2026). Category leader. Fortune 500. Analyst-heavy, reporting-first. |
| **Peec AI** | €89/mo (25 prompts) → €199/mo Pro (100 prompts) | €29M raised; 0 → $10M ARR in 16 months. Unlimited seats. Unlimited countries/languages. Clean UI. Claude/Gemini/AI Mode are paid add-ons. |
| **Otterly.ai** | **$29/mo** (15 prompts) → $189 Standard | Cheapest credible entry. GEO audit feature. Looker Studio connector. Agency white-label. |
| **Scrunch** | $250/mo (125 prompts) | Persona modelling, funnel analysis, Agent Experience Platform, SOC 2 Type II. |
| **LLMrefs** | $79/mo flat, 500 prompts | Best raw value. |
| **AthenaHQ / Evertune / Bluefish / Rankscale / ZipTie / xFunnel** | varies | All real, all funded, all narrow. |
| **Semrush AI Visibility Toolkit** | $99/mo per domain | Bolt-on. |
| **Ahrefs Brand Radar** | realistically $828+/mo all-in | Bolt-on. |

**Every single one of them is a measurement tool.** The universal critique, repeated in guide after guide: *"They diagnose the problem but don't fix it. They track citations but leave content creation, schema implementation, and authority-building to your internal team."* And: *"Measurement without action is theater."*

### 4.2 Agentic SEO (the actual competition)

- **Ahrefs Agent A**: agent-building platform with connectors to WordPress, Slack, **GitHub**, HubSpot, Notion, Linear, Stripe. The "Fix with Agent A" → GitHub PR → re-crawl-to-verify loop is live. **This is your closest competitor and your proof of concept, both at once.**
- **Open-source Claude Code skill suites** on GitHub (`AgricIDaniel/claude-seo` and similar): 25 sub-skills, 18 sub-agents, technical SEO, E-E-A-T, schema, GEO/AEO, backlinks, local SEO, Google APIs, parallel execution with up to 15 specialist agents. MIT licensed. **Read these repos.** They are free architecture documentation for exactly what you are building, and they tell you what the ceiling of a CLI-only approach looks like (no persistence, no dashboard, no multi-tenant, no non-technical user).
- **Similar.ai, SEObot, Rampify, HeySeo**: GSC-connected content agents.

### 4.3 Where the gap actually is

```
                 MEASURES              FIXES              SHIPS CODE
Profound/Peec/     ✅                    ❌                    ❌
Otterly/Scrunch

Semrush/Ahrefs     ✅                 partial                ❌ (Agent A: partial)
Screaming Frog     ✅                    ❌                    ❌

Claude-Code        ✅                    ✅              ✅ (but: devs only,
SEO skills                                                 no UI, no tenancy)

YOUR AGENT         ✅                    ✅              ✅ + non-technical UI
                                                          + multi-tenant
                                                          + verification loop
```

**Your positioning sentence:**
> *"Every other AI-SEO tool sends your marketer a list. We send your repo a pull request."*

---

## Part 5: Product architecture

### 5.1 High-level system

```
┌─────────────────────────────────────────────────────────────────┐
│  WEB APP (Next.js / React)                                       │
│  Dashboard · Findings inbox · PR review · Reports · Chat         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  API / ORCHESTRATION LAYER                                       │
│  Auth · Multi-tenant · Job queue · Budget guard · Audit log      │
└───┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
    │          │          │          │          │
┌───▼───┐ ┌────▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼──────┐
│CRAWLER│ │  DATA    │ │  LLM   │ │  REPO  │ │ REPORTING│
│(Playw-│ │CONNECTORS│ │ VISIB- │ │ AGENT  │ │  ENGINE  │
│right) │ │ GSC/GA4/ │ │ ILITY  │ │(GitHub │ │ Looker/  │
│       │ │ PSI/CrUX/│ │ POLLER │ │  App)  │ │ PDF/HTML │
│       │ │ DataFor  │ │        │ │        │ │          │
│       │ │ SEO/GBP  │ │        │ │        │ │          │
└───────┘ └──────────┘ └────────┘ └────────┘ └──────────┘
    │          │          │          │          │
┌───▼──────────▼──────────▼──────────▼──────────▼─────────────────┐
│  AGENT CORE (orchestrator + specialist sub-agents)               │
│  Skills as separate files. Each loads only when relevant.        │
└───┬──────────────────────────────────────────────────────────────┘
    │
┌───▼─────────────────────────────────────────────────────────────┐
│  POSTGRES (findings, crawls, snapshots, PRs, tenants)            │
│  + object store (raw crawl artefacts, screenshots)               │
│  + vector store (page embeddings for internal linking + gaps)    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 The specialist sub-agents

Use **separate skill files, one job each.** The Ahrefs guidance is explicit and matches Anthropic's own: *"It keeps things clearer and helps the AI use the right context more effectively."* Each skill loads only when relevant, preventing context rot. This also matches your own stated preference for modular files over monoliths.

| Agent | Owns | Writes code? |
|---|---|---|
| **Orchestrator** | Task decomposition, prioritisation, budget, human-approval gates | no |
| **Crawler** | Site crawl, link graph, render check, status codes | no |
| **Technical SEO** | robots/sitemap/canonical/hreflang/indexation findings | **yes** |
| **Performance** | CWV field + lab, LCP/INP/CLS attribution | **yes** |
| **Schema** | Detect, validate, generate JSON-LD | **yes** |
| **Content** | Briefs, gaps, cannibalisation, GEO rewrites, freshness | **yes** (MDX/CMS) |
| **Internal Link** | Link graph analysis, contextual link insertion | **yes** |
| **Backlink / PR** | Competitor gap, prospect scoring, outreach drafts, unlinked mentions | no (drafts only) |
| **AI Visibility** | Multi-engine prompt polling, stability scoring, citation-source mining | no |
| **Local** | GBP, NAP, geo-grid, LocalBusiness schema | **yes** (schema) |
| **Social/Platform** | GSC Platform Properties, entity consistency, `sameAs` | no |
| **Agent-Readiness** | llms.txt, Lighthouse Agentic Browsing, WebMCP, accessibility tree | **yes** |
| **Reporter** | Weekly digest, monthly report, Looker feed | no |
| **Verifier** | Re-crawl after merge, confirm the issue is gone, track the metric | no |

### 5.3 The repo connection (your moat)

**Use a GitHub App, not a personal access token.** Reasons: fine-grained per-repo permissions, installation-scoped tokens that expire, an auditable installation record, and it works for orgs.

Minimum permissions:
- `contents: write` (create branches, commit)
- `pull_requests: write` (open PRs)
- `metadata: read`
- Optionally `checks: read` (to see if CI passed on your PR)

**Never push to `main`. Always open a PR.** Every PR must contain:
1. The diff.
2. The finding it resolves, with the evidence (before/after metric, screenshot, Lighthouse trace).
3. A rollback note.
4. An explicit "how would we know this failed?" check. (The best open-source SEO skill suite makes every recommendation carry its falsification condition. Steal that. It is also exactly what a Quantic examiner will reward.)

**Framework detection** from the repo is a huge unfair advantage. `package.json` + config files tell you instantly whether you are in Next.js (App Router vs Pages), Nuxt, Astro, SvelteKit, Remix, Gatsby, plain React SPA, WordPress, Hugo, Jekyll, Django, Rails, Frappe. That determines *where the fix goes*:

| Finding | Next.js App Router | WordPress | Astro |
|---|---|---|---|
| Missing meta description | `export const metadata` in `page.tsx` | Yoast/Rank Math field or `wp_head` filter | frontmatter |
| No sitemap | `app/sitemap.ts` | plugin | `@astrojs/sitemap` |
| CSR-only page | convert to Server Component / add `generateStaticParams` | n/a | default SSG |
| LCP image not prioritised | `<Image priority>` | `fetchpriority` filter | `<Image loading="eager">` |
| Missing JSON-LD | `<script type="application/ld+json">` in layout | schema plugin or functions.php | component |

**Support more than GitHub.** Your brief says "any other version control tool." GitLab (merge requests) and Bitbucket (pull requests) have equivalent APIs. Abstract this behind a `VersionControlProvider` interface from day one:

```ts
interface VersionControlProvider {
  listRepos(): Promise<Repo[]>
  detectFramework(repo: Repo): Promise<Framework>
  readFile(repo: Repo, path: string): Promise<string>
  createBranch(repo: Repo, base: string, name: string): Promise<Branch>
  commitChanges(branch: Branch, changes: FileChange[]): Promise<Commit>
  openPullRequest(pr: PullRequestSpec): Promise<PullRequest>
  getPullRequestStatus(pr: PullRequest): Promise<PRStatus>
}
```

Implement `GitHubProvider` in sprint 1; `GitLabProvider` in sprint 3 if time allows. This is exactly the kind of pattern the Quantic rubric rewards under "software and architectural patterns used and reasons for their use" (Strategy / Adapter).

### 5.4 Google Search Console: what you can and cannot do

**Important correction to your brief.** You wrote *"could also create a Google Search Console account with their gmail account."* You cannot create a Google account for a user, and you should not ask for their Google password (that would break Google's ToS and get your OAuth client banned). But here is what you *can* do, and it is arguably better:

**The flow (and this is a killer feature because you have the repo):**

1. User clicks "Connect Google Search Console."
2. **OAuth 2.0 consent** (scopes: `https://www.googleapis.com/auth/webmasters` for read/write, plus `https://www.googleapis.com/auth/siteverification`). Store the **refresh token** encrypted, per tenant.
3. Call **`sites.list`** to see what properties they already have.
4. If their domain is not there, call **`sites.add`** to add the property (`sc-domain:example.com` for a domain property, or a URL-prefix property).
5. **Verification.** This is where you win: call the **Site Verification API** `webResource.getToken` to get an HTML file token or meta tag. Then **your repo agent opens a PR** that drops `google[hash].html` into `/public` or adds the `<meta name="google-site-verification">` tag to the layout. User merges. You call `webResource.insert` to complete verification. **Fully automated verification that no competitor can offer, because they don't have the repo.**
   - For a `sc-domain:` property you need a **DNS TXT record**, which you cannot write. Fall back to asking, or offer to detect their DNS provider and give copy-paste instructions.
6. Then pull data.

**API surface and hard limits (all free, quota-limited, no billing):**

| Resource | What you get | Limits |
|---|---|---|
| **Search Analytics** (`searchanalytics.query`) | clicks, impressions, CTR, position by query / page / country / device / date / searchAppearance | **25,000 rows per request** (paginate with `startRow`); ~**50,000 page-keyword pairs per property per day**; 1,200 QPM per site/user; **2 to 3 day data lag**; UI caps at 1,000 rows and 16 months |
| **URL Inspection** (`urlInspection.index.inspect`) | index status, coverage state, robots state, canonical (Google's vs yours), last crawl, page fetch state, rich results, mobile usability | **2,000 QPD and 600 QPM per property.** Hard. Prioritise: top 100 pages by traffic + anything published recently. `inspectionDepth: FULL` forces a live re-fetch. |
| **Sitemaps** (`sitemaps.*`) | list, submit, delete | light |
| **Sites** (`sites.add/list/delete`) | add/remove properties | ~10 QPS |
| **Platform Properties** (new, July 2026) | IG/TikTok/X/YouTube Search + Discover performance | rolling out; UI first |

**Auth choice, and get this right:** use **OAuth with the user's own consent** (each tenant authorises their own GSC), *not* a service account. A service account would require the client to manually add your service account email as a user on every property, which is a support nightmare, and it is the #1 cause of mysterious 403s. Service accounts are for *your own* internal pipelines.

**Quota engineering that will show up in your design doc:**
- Combine `[query, page]` dimensions in one call and Google anonymises low-volume rows; **pull dimensions separately and join client-side** for completeness.
- Cache aggressively by date range. Never re-query a closed month.
- Exponential backoff on 429.
- Consider the **Bulk Data Export to BigQuery** for large sites (bypasses the 50k row sampling ceiling entirely).
- The property-splitting trick: creating multiple GSC properties by directory path multiplies the 50k daily quota. One vendor reports reducing impression loss from 67% to 11% and increasing keyword capture 13.7x by adding 50 directory-segmented properties. Worth knowing; probably out of scope for the capstone.

### 5.5 Data sources and cost model

| Source | What for | Cost |
|---|---|---|
| **Google Search Console API** | Truth for organic performance + indexation | **Free** |
| **PageSpeed Insights API** | Lab (Lighthouse) + field (CrUX) in one call | **Free** (25k req/day with key) |
| **CrUX API / CrUX on BigQuery** | Field CWV trends, origin-level history | **Free** |
| **Google Analytics Data API (GA4)** | Post-click behaviour, LLM referral traffic | **Free** |
| **Google Business Profile API** | Local | **Free** (approval needed) |
| **Site Verification API** | Auto-verify properties | **Free** |
| **Your own crawler** (Playwright + Node/Python) | On-page, link graph, rendering, schema | Compute only |
| **Schema.org validator / Rich Results Test** | Validation | Free |
| **DataForSEO** | SERP, keyword volume/difficulty, **backlinks**, business listings, **LLM Mentions API + AI Search Volume** | Standard queue **$0.60 / 1,000** (~5 min async); Priority $1.20/1k; Live $2.00/1k. **$50 minimum top-up, credits never expire.** 2,000 req/min. |
| **SerpApi** | Live SERP + AI Overview parsing as discrete fields | Free tier **250 searches/mo**; Developer ~$75/mo for 5,000. Unused searches expire. |
| **Serper.dev** | Cheapest real-time Google | $1.00/1k → $0.30/1k at volume |
| **Ahrefs / Semrush API** | Best backlink index | Ahrefs API is **enterprise only** (~$1,499/mo committed). **Out of scope.** |
| **LLM APIs** (Claude, GPT, Gemini, Perplexity) | The agent itself + visibility polling | Metered. Use tiered routing: Haiku for classification/extraction, Sonnet for reasoning/code. One open-source reference reports a 20-URL audit at ~$0.12. |

**Recommended capstone stack:** GSC + PSI + CrUX + GA4 (all free) + your own crawler + **DataForSEO on a $50 top-up** for SERP/backlinks/keyword data + **SerpApi free tier** for live AI Overview parsing. Total marginal data cost for a full capstone: **under $100.** That is a real, defensible cost model and it belongs in your design document.

### 5.6 The scoring model

Do not ship a single vanity "SEO score out of 100." Ship a **scorecard with independent axes**, because they move independently and a single number hides everything:

```
CRAWL HEALTH        ████████░░  82   (indexation, robots, sitemap, canonicals)
PERFORMANCE         ████░░░░░░  41   (CWV field data, p75, 28-day)
CONTENT             ██████░░░░  63   (depth, originality, freshness, cannibalisation)
STRUCTURE           ███████░░░  71   (internal links, depth, orphans, schema)
AUTHORITY           ███░░░░░░░  29   (referring domains, brand mentions, PR)
LOCAL               ██████████  95   (GBP, NAP, reviews)
AI VISIBILITY       ██░░░░░░░░  18   (citation rate, stability, share of voice)
AGENT READINESS     █░░░░░░░░░  12   (llms.txt, WebMCP, a11y tree, UCP)
```

Each finding carries: **severity × confidence × estimated effort × estimated impact**, and a **falsification condition** ("how would we know this failed?"). Sort the backlog by impact/effort. That is the prioritisation engine, and it is the actual product.

### 5.7 The verification loop (the thing that makes it science)

This is what separates you from every "AI SEO" vendor selling vibes, and it is what will get you a 5 on the Quantic rubric.

```
1. BASELINE    snapshot GSC + CWV + AI visibility (3 polls) for the affected pages
2. HYPOTHESIS  "Adding fetchpriority to the LCP image will move p75 LCP below 2.5s"
3. INTERVENE   open PR → human merges → deploy
4. WAIT        CWV needs ~28 days (rolling window). GSC needs ~2 to 3 days for data.
5. VERIFY      re-crawl; re-poll; compare against baseline AND against a control set
               of untouched pages (to rule out sitewide/seasonal drift)
6. REPORT      "shipped, verified, moved" OR "shipped, no movement, hypothesis rejected"
```

**The control group is the whole point.** HeyTony's study only produced real findings because they compared cited pages against *pages that ranked but were never cited*. Without controls, you learn nothing and you ship superstition. Bake control groups into the product.

---

## Part 6: The Nairobi / Code 5 angle

You have a natural, defensible market position that Profound and Peec cannot touch.

- **Price.** Otterly's $29/mo entry point is already unaffordable for most Kenyan SMEs, and Profound's realistic $399+ is absurd. A tool priced in KES with a free audit tier and a KES 3,000 to 10,000/month paid tier has an entire market to itself.
- **Local SEO is where the money is here.** Kenyan SMEs (clinics, law firms, schools, hotels, safaris, tile suppliers, aquaculture, exactly Code 5's existing client list: `rangautiles.com`, `heartbeetsafaris.com`, `lakevictoriaaquaculture.com`) win or lose on the map pack, not on AI Overviews. GBP + NAP + reviews + LocalBusiness schema is 80% of their upside.
- **The AI Overview scope finding applies directly.** A Nairobi business scoping every claim to "Westlands" cannot support a Kenya-level AI answer. Content should be scoped at the **country level** first, then localised. That is counter-intuitive advice nobody in this market is giving.
- **Kenya-specific data is rare, and rare data is linkable.** The digital-PR playbook says the counterintuitive statistic is the press angle. *"We audited 500 Kenyan SME websites and 74% are invisible to ChatGPT"* is a report that Business Daily, TechCabal and Nation would cover, that earns you DR 70+ backlinks, and that seeds your own brand mentions in exactly the sources AI engines cite. **Run that study with your own tool. It is simultaneously your capstone dataset, your marketing, and your proof of product.**
- **The billing reality:** M-Pesa. You already debugged Daraja STK push at GCH. That integration is a competitive moat in this market and a genuinely impressive capstone feature.
- **Deployment reality:** Kenyan mobile users are on mid-range Android over patchy mobile networks. That is *literally the 75th percentile user* Core Web Vitals is designed around. Performance work has outsized ROI here.

---

## Part 7: Mapping this to the Quantic MSSE capstone

Reading the handbook against this project, you are in very good shape. Notes:

### Deliverables checklist (from the handbook)

| Required | Your plan |
|---|---|
| GitHub repo shared with **`quantic-grader`**, code documented | Monorepo. Do this in sprint 1, do not forget. |
| Link to **deployed version** in the repo | Render / Railway / Fly.io free tier. Frontend on Vercel. Postgres on Neon/Supabase free tier. |
| Link to **agile task board** (Trello or equivalent) | You already live in YouTrack; a public Trello or GitHub Projects board is safer for a grader. Mirror it. |
| **Design and testing document** in the repo | See below. This is where you win or lose. |
| **15 to 20 min recorded demo**, all members on camera + screen share, **government ID shown**, single `.mp4`, Google Drive, "anyone with link" | Non-negotiable mechanics. Rehearse. |
| **≥ 3 sprints**, weekly scrum, sprint-end demo recordings to the Product Owner | Below. |
| Group Project Agreement final page, signed | Admin. |
| One member submits for the group | Admin. |

### The design and testing document (rubric-critical)

The rubric explicitly demands: *"design and architecture decisions made... including any software and architectural patterns used and reasons used... what deployment options are recommended (on-premises or cloud) including relative cost implications... all testing done including any and all automated tests used and reasons why."*

Your document must therefore include:

**Architecture decision records (ADRs).** One per decision:
- Why an **event-driven / job-queue** architecture rather than synchronous request-response (crawls take minutes; LLM calls are slow; you need retries and idempotency). You already have event-driven experience from GCHMIS, so lean on it.
- Why **GitHub App** over PAT (least privilege, expiring tokens, auditability).
- Why **OAuth per-tenant** over service account for GSC (403 hell, support burden).
- Why **Strategy/Adapter** for `VersionControlProvider` and for `LLMProvider` (vendor lock-in avoidance, cost routing).
- Why **skill-file decomposition** for the agent rather than one mega-prompt (context management, testability, cost).
- Why **Repository pattern** over direct ORM calls.
- **Multi-tenancy model:** row-level security in Postgres, tenant_id on every table, and an explicit statement of why (this is a real security decision and graders love it).
- **Deployment cost analysis:** free-tier (Render + Neon) vs cloud (AWS ECS + RDS) vs on-prem, with actual monthly numbers. The handbook asks for this by name.

**Testing strategy.** Be specific about *why* each type:
- **Unit** (Jest/Vitest, Pytest): the deterministic core. robots.txt parser, sitemap parser, canonical resolver, CWV threshold classifier, scoring functions, link-graph algorithms. These must be 100% deterministic and 100% covered. **This is the majority of your logic and it does not involve an LLM at all.**
- **Integration**: GSC API client against a mock server; GitHub App against a test repo; DB migrations.
- **Contract tests** for each external API (they change; you need to know when).
- **E2E** (Playwright): connect repo → run audit → see finding → open PR.
- **LLM evaluation harness** (this is the sophisticated bit, and it maps to "AI engineering techniques" in the handbook): a golden dataset of ~50 pages with known ground-truth issues. Run the agent. Measure **precision and recall of findings**. Track **hallucination rate** (findings that reference code that does not exist). Track **PR merge rate** and **PR revert rate** as your real-world quality metric. Snapshot-test prompts so a prompt change that regresses quality fails CI.
- **CI/CD** (GitHub Actions): lint → typecheck → unit → integration → build → deploy on merge to main. The rubric names CI/CD explicitly at the 5 level: *"Appropriate software engineering methodology and collaborative software engineering tools, including CI/CD tools, have been used."*

### Suggested sprint plan (3 sprints, ~3.5 months)

**Sprint 0 (startup meeting):** Product Owner = you (it is your workplace-adjacent idea, so the handbook says the PO should be you). Nominate a Scrum Master. Agree the stack, the board, the branch strategy, Code Owners for PR approval.

**Sprint 1: The audit engine (prove the diagnosis).**
- Crawler (Playwright) + link graph + on-page extraction.
- Technical SEO rule engine (deterministic; ~40 checks).
- PSI/CrUX integration → CWV scorecard.
- GSC OAuth + Search Analytics + quick-wins report (position 4-20, impressions ≥50, CTR <5%).
- Basic dashboard. Auth. Multi-tenancy.
- **Demo:** point it at `code5developers.com` and one client site; show findings.

**Sprint 2: The fix engine (prove the differentiator).**
- GitHub App install flow; framework detection.
- Fix generators for the top 10 highest-frequency findings.
- PR generation with evidence + rollback + falsification note.
- Human-approval gate in the UI.
- Verifier: re-crawl after merge, close the finding, record the delta.
- GSC property auto-verification via PR (the meta-tag drop). **This is the "wow" moment of your demo.**
- **Demo:** merge a PR generated by the agent, watch the finding close.

**Sprint 3: The AI visibility + off-site layer (prove the vision).**
- Multi-engine prompt polling with **3-check stability scoring** (ChatGPT, Perplexity, AI Overviews via SerpApi, Gemini).
- Share-of-voice vs competitors; citation-source mining ("who is being cited instead of you, and where do we need to get mentioned").
- Backlink gap + prospect scoring + outreach drafts (draft only, never auto-send).
- Agent-readiness audit (llms.txt, Lighthouse Agentic Browsing, accessibility tree).
- GSC **Platform Properties** for social (if the API/UI allows by then).
- Competitor change-detection (the "Watchdog" clone). Weekly diff.
- Looker Studio connector or native report export.
- **Demo:** the full loop, plus the Kenya SME study as the proof artefact.

### Rubric alignment: how to score a 5

The 5 requires *"initiative demonstrated by the project software deliverable going above and beyond the minimum Capstone requirements."* Your above-and-beyond items, ranked:

1. **The agent ships code.** Nobody else's capstone will open pull requests.
2. **The falsifiability discipline.** Every finding carries its own disproof condition; every claim is measured against a control group. That is engineering rigour, and it is rare.
3. **The LLM eval harness with precision/recall/hallucination metrics.** This is real AI engineering, and it is what the handbook means by *"AI engineering techniques."*
4. **The original research study** (500 Kenyan SME sites) as a data artefact produced *by* the system.
5. **Correctly refusing to sell llms.txt as a ranking factor**, with a citation to Google's own June 2026 documentation, inside the product UI. Intellectual honesty as a feature.

---

## Part 8: Risks, constraints and ethics (put these in the doc; graders reward them)

| Risk | Mitigation |
|---|---|
| **Agent pushes a bad change and breaks production.** | Never push to main. PR only. Human approval gate. Require CI green. Rollback note in every PR. Blast-radius limit: max N files per PR. |
| **Scraping Google directly violates ToS.** | Do not scrape Google yourself. Use DataForSEO / SerpApi, who carry that risk (note: SerpApi has active litigation exposure as of 2026; keep a DataForSEO fallback). |
| **Asking for a user's Google password.** | Never. OAuth only. Say so in the UI. |
| **GSC quota exhaustion** (2,000 URL inspections/day/property). | Prioritise top-100 pages + recent publishes. Cache. Backoff. |
| **LLM cost blowout.** | Tiered model routing (Haiku for extraction/classification, Sonnet for reasoning/code gen). Per-tenant budget caps. Cache crawl artefacts so re-runs are cheap. |
| **Hallucinated findings** (agent reports a bug in code that doesn't exist). | **Deterministic checks first, LLM second.** The rule engine finds the issue; the LLM only explains and fixes it. Never let the LLM be the detector for anything a parser can detect. This is the single most important architectural decision in the whole product. |
| **Auto-outreach becomes spam.** | Draft only. Human sends. Rate limits. Never auto-send. |
| **Link buying / PBNs.** | Hard-coded refusal. Ship it as a policy page. |
| **Doorway pages** from programmatic local SEO. | Hard cap (warn at 30 pages, stop at 50). |
| **Data privacy (Kenya Data Protection Act 2019; GDPR if EU clients).** | Encrypt refresh tokens at rest. Explicit consent screens. Data deletion endpoint. Do not store crawled PII. Document the lawful basis. |
| **Google's spam policies apply to AI features too.** | Do not generate scaled low-value content. The "Who / How / Why" heuristic from Google's helpful-content guidance should gate every piece of content the agent generates. |
| **Cloudflare 15 Sept 2026 default change** breaks clients' crawler access. | Detect it. Warn them. This is a feature, not a risk. |

---

## Part 9: Primary sources (read these directly, not the summaries)

**Google, official:**
- Optimizing your website for generative AI features on Google Search: `https://developers.google.com/search/docs/fundamentals/ai-optimization-guide` (updated 15 June 2026)
- Search Central blog, "A new resource for optimizing for generative AI in Google Search" (15 May 2026)
- Search Central blog, "See how content from social and video platforms performs on Google Search" (7 July 2026) — Platform Properties
- Search Console API usage limits: `https://developers.google.com/webmaster-tools/limits`
- URL Inspection API launch post (Jan 2022)
- Evaluating third-party SEO advice: `https://developers.google.com/search/docs/fundamentals/third-party-seo`

**Academic:**
- Aggarwal et al., *GEO: Generative Engine Optimization*, arXiv **2311.09735**, KDD 2024. Code: `github.com/GEO-optim/GEO`
- The 2026 position paper on GEO governance risks, arXiv 2606.12439 (useful for your ethics section)

**Industry research worth trusting (has methodology):**
- HeyTony, *"How Do You Get Cited in Google AI Overviews? I Tested 100 of Them to Find Out"* (7 June 2026) — the control-group study
- HeyTony, *"What SEO Software & Tools Do We Use at HeyTony?"* (30 June 2025)
- Ahrefs, AI Overview citations vs top 10 study (~4M URLs)
- Ahrefs, Brand Authority study (75,000 brands; mentions vs backlinks correlation with AI visibility)
- SE Ranking, llms.txt adoption study (300,000 domains)
- Muck Rack, *"What Is AI Reading?"* (May 2026)
- HTTP Archive Web Almanac 2025, Performance chapter (CWV pass rates)
- Cloudflare blog, *"Your site, your rules: new AI traffic options for all customers"* (1 July 2026)
- Ahrefs, *"AI Agents for SEO: What They Are, How They Work, and How to Build One"* (May 2026)

**Code to read:**
- `github.com/AgricIDaniel/claude-seo` — 25 sub-skills, 18 sub-agents, MIT. The best free architecture doc for what you're building.
- `github.com/GEO-optim/GEO` — the original GEO prompts
- `github.com/topics/agentic-seo`, `github.com/topics/technical-seo` — the field

---

## Appendix: The 60-second pitch

> Businesses spend $29 to $500 a month on tools that tell them ChatGPT recommends their competitor. Then they email a 400-line spreadsheet of technical issues to a marketer who cannot write code, and nothing gets fixed.
>
> We connect to your repository. We crawl your site, read your Search Console, poll every AI engine three times over three days, and audit the eight surfaces that decide whether you get found. Then we open a pull request.
>
> Not a recommendation. A diff. With the evidence, the rollback plan, and the exact condition under which we'd admit we were wrong.
>
> You merge it. We verify it moved. We show you the number.
