# Competitive research: the HeyTony tool suite

What nine links taught us, which of their features are worth rebuilding, and how to rebuild each one
so it obeys the laws in `CLAUDE.md` and does something the original cannot.

Researched: 2026-09-16. Status: **research only; nothing below is built yet.** Each roadmap item is
a separate, shippable story. Read `docs/state-of-play.md` first for the constraints every item has
to live inside.

---

## 1. What the links turned out to be

All nine links belong to one ecosystem: **HeyTony**, the Hamilton, Ontario SEO agency run by Matt
Diamante (about 30,000 students taught, a HeyTony Insiders membership at $97 a month). Almost every
tool is a free lead magnet: a result preview on screen, the full report as a PDF behind an email
address, and a low per-IP rate limit.

Two of the links are results pages for a real Kenyan business, `rangautiles.com` (building
materials and sanitaryware, Rongai, Nairobi), and a LinkSeeker search for the niche "tiles". That
makes it a useful benchmark: whatever we build can be run against the same site and compared.

| Tool | What it does | How it works | Limits and access |
|---|---|---|---|
| [LinkGap](https://linkgap.io/) | Backlink gap: domains that link to a competitor but not to you. Titled "Find Directory Opportunities". | Backlink data from **DataForSEO** (named on its [terms page](https://linkgap.io/terms)). Results cached for 30 days. | 3 analyses per hour per IP. Full report is a PDF by email. The home page blocked our fetcher; the terms page and search results were used instead. |
| [LinkSeeker](https://linkseeker.io/) | Enter a niche, get "websites actively seeking guest contributors". "tiles" returned 44 opportunities. | Method undisclosed; the output shape is what SERP footprints such as `"write for us"` produce. | The prospect rows are only in the emailed PDF; the status page shows a count. |
| [Find Questions](https://findquestions.com/) | Mines **Reddit** for real customer questions, returns 40 blog topics and subreddits to watch. | Reddit discussions plus AI summarisation. Advises specific inputs ("roof repair", not "roofer"). | Free preview, PDF by email; more behind Insiders. |
| [HeyKeywords](https://heykeywords.com/) | Five tools: keyword research (volume, difficulty, CPC, intent), domain analysis (keywords a domain ranks for, estimated traffic), **keyword gap**, **backlink gap**, find questions (intent and topic clustering). CSV export. | Third-party estimates; the site says volumes, difficulty and traffic "are estimates only". | Paid: $29, $49, $99 a month, metered per search. |
| [What Is My CID](https://whatismycid.com/) | Paste a Google Maps share link, get the **CID, CID link, Place ID and review link**. | Decodes identifiers embedded in the share URL. Warns that direct search result links may not work. | Free. |
| [What Is My Website About](https://whatismywebsiteabout.com/) | "See what search engines think your website is about": topic clusters with percentages and page counts, drawn as a treemap. | Reads the sitemap, takes each page's title and description, and asks **Claude** to categorise them. Up to 500 pages. | Free, optional PDF. |
| [Rank Report Card](https://rankreportcard.com/) | "50+ ranking factors" in under 60 seconds. The `rangautiles.com` result: **C, 76/100**, 29 passed, 8 warnings, 6 failed. | Checks seen in the result: sitemap, viewport, HTTPS, alt text, internal linking, JSON-LD, Open Graph, LocalBusiness schema, a Google Business Profile link, desktop and mobile lab scores (LCP, CLS, TBT), touch targets. | 3 scans a day. The explanation of each failure is behind an email gate, with an "expert help" upsell. |
| [YouTube ju148x57spI](https://www.youtube.com/watch?v=ju148x57spI) | "Optimizing Product Pages", Matt Diamante. | No transcript was retrievable. The written version on HeyTony's blog, [How To Improve Product Page SEO By Increasing Word Count](https://heytony.ca/how-to-improve-product-page-seo-by-increasing-word-count/), recommends adding specifications, how-to guides, reviews, FAQs, comparisons, use cases, warranty and returns, safety and compliance, and video. | Public. |
| HeyTony Insiders course | The paid course. | **Not accessed.** It sits behind a login and we do not type a client's credentials into a third-party site on their behalf. Public HeyTony material was used instead: the [local SEO checklist](https://heytony.ca/local-seo-checklist-the-ultimate-guide-to-local-seo/) (44 items), the product page article, and the [tools page](https://heytony.ca/seo-software-used-at-heytony/), which also lists a Website Audit ($10 a month, 1,000 pages, monthly report) and **Watchdog**, a weekly competitor change monitor ($10 a month). | If the lessons matter, export the lesson titles or notes by hand and add them to this document. |

---

## 2. Where these tools are weak, and where we are strong

None of this is a criticism of the tools as lead magnets; they are good at that. It is a list of the
places where a product with a repo and a Search Console connection can do something they cannot.

1. **They estimate what we can measure.** Keyword gap, question mining and domain analysis all guess
   a site's rankings from a third-party index, which is weakest exactly where our clients live:
   small sites in small markets. We hold the client's own Search Console data, so "a keyword you do
   not rank for" can mean a keyword with zero impressions, not one the vendor did not see.
2. **One of them uses an LLM as the detector.** What Is My Website About asks a model what a site is
   about. That is the pattern rule 1 forbids. We can measure topical structure (embeddings,
   deterministic clustering, the internal link graph, GSC queries) and use the model only to name
   what was measured.
3. **Every one of them ends in a PDF.** A CID, a missing `offers` block, a LocalBusiness schema
   without `hasMap`: each of these is a diff, and we are the only product positioned to open it.
4. **Some of their advice contradicts primary sources.** Word-count targets, FAQ blocks and FAQ
   schema (FAQPage rich results were switched off for all sites on 7 May 2026, and FAQ blocks do not
   separate winners from losers in citation studies), a single grade out of 100, and guest posting
   as a link tactic. Section 4 lists what we will not build and why.
5. **They are one-shot.** Nothing re-checks whether the advice worked. Our loop verifies in
   production and states a falsification condition up front.

---

## 3. Roadmap

Ten items in three tiers. Each tier is ordered by value against cost, and each item ships on its own
branch with its own story, tests and, where a decision is made, ADR. Rule IDs are proposals; check
`packages/rules/src/registry.ts` for collisions before using one.

### Tier 1: free, deterministic, built on what already exists

#### 1. Content intelligence from Search Console

**Built, 2026-09-20.** Both checks ship in `packages/connectors/src/gsc/cannibalisation.ts` and
`packages/connectors/src/gsc/questions.ts`, wired through `packages/audit/src/search.ts`. The
thresholds below are the ones in the code; what follows is the design they were built to.

The content axis coverage note in `packages/rules/src/coverage.ts` says cannibalisation is not
measured. This closes that, using data we already fetch.

- **CONTENT-001, keyword cannibalisation.** A query where two or more of the site's URLs each take a
  material share of impressions over the 28-day window and neither holds a stable position.
  - Evidence: the query, each URL, impressions, clicks and average position per URL.
  - Falsification: after consolidation, one URL takes at least 80% of the query's impressions in the
    next full window. If both still split it, the fix failed.
  - Not fixable: which page should win is a content decision, so this stays a finding.
- **CONTENT-002, unanswered question queries.** Search Console queries shaped as questions (who,
  what, how, why, when, where, can, does, is, cost, price; keep the word list in a data file so other
  languages can be added) with meaningful impressions, an average position worse than 10, and no
  crawled page whose title or H1 covers the query's head terms.
  - This is Find Questions built on demand the site is **already receiving**, rather than on what
    Reddit is discussing in general.
  - Falsification: a page published for the question reaches page one for that query, or collects
    the impressions, within two windows.
- Reuse: `searchAnalytics` in `packages/connectors/src/gsc/client.ts`, the shape of
  `packages/connectors/src/gsc/quick-wins.ts`, and the wiring in `packages/audit/src/search.ts`.
  Update `THIN_COVERAGE.content` when it lands.
- Mind the API ceilings: 25,000 rows per request and a 2 to 3 day lag. Query plus page dimensions is
  the expensive combination, so fetch it once per audit and derive both rules from the same rows.

#### 2. Local business identity, done as a pull request

**Built, 2026-09-20.** The parser is `packages/connectors/src/local/maps-url.ts`, the profile is stored per site and edited from the dashboard, and LOCAL-002 with `packages/fixers/src/fixers/local-profile-links.ts` turns a thin LocalBusiness block into a pull request. LOCAL-003 and LOCAL-004 are built too, both as findings rather than pull requests.

What Is My CID decodes a share link and stops. We decode it, store it, and put it in the client's
markup.

- **Parser**, a new pure module at `packages/connectors/src/local/maps-url.ts`:
  - Resolve short links (`maps.app.goo.gl`, `g.page`, `goo.gl/maps`) with one manual-redirect
    request. Only follow redirects to Google hosts; this is user-supplied input and must not become
    an SSRF primitive.
  - Parse the feature ID from `!1s0x<hex>:0x<hex>`. The CID is the second half as an unsigned
    64-bit integer: `BigInt('0x' + hex).toString()`. Also accept `cid=` and `ludocid=` parameters,
    and `place_id:` when present.
  - Outputs: CID, `https://maps.google.com/?cid=<cid>`, Place ID, and the review link
    `https://search.google.com/local/writereview?placeid=<placeId>`.
- **Place ID when the URL does not carry one:** Places API (New) Text Search with the field mask
  `places.id`. Off unless a `GOOGLE_MAPS_API_KEY` is configured. If it is not, the user pastes the
  Place ID; we never invent one.
- **Storage:** `gbp_cid` and `gbp_place_id` on the site. The migration is hand-written and
  hand-registered in `meta/_journal.json` (see the migrations trap in the state of play). A settings
  field labelled "Google Maps share link".
- **LOCAL-002**, fixable: LocalBusiness structured data exists but has no `hasMap` or `sameAs`
  pointing at the verified profile. Extend `packages/fixers/src/fixers/local-business.ts` to emit
  both. Falsification: the Rich Results Test on the merged page shows the properties; if the
  profile URL does not resolve to the same business, the fix is wrong.
- **LOCAL-003**, NAP drift inside the site: the phone number or address shown in the footer or
  contact page differs from the JSON-LD `telephone` or `address`. Compare normalised values (E.164
  phone numbers, address tokens). A pure crawl rule with fixtures. Consistency across external
  directories is a separate, later piece of work.
- **LOCAL-004**, info: no review link and no map embed on the contact page (HeyTony's checklist item
  39). A finding with a ready snippet, not an automatic fix, because it changes what visitors see.

#### 3. Product pages, without the myths

**Built, 2026-09-20**, as PROD-001 and PROD-002 in `packages/rules/src/rules/product.ts`, on the
structure axis. The product page lesson, filtered through what primary sources say.

- Detect a product page deterministically: Product JSON-LD, `og:type` of `product`, or platform
  markers (Shopify, WooCommerce).
- **PROD-001:** a product page with no Product structured data, or Product data without an `offers`
  block carrying `price`, `priceCurrency` and `availability`. This is what merchant listing
  eligibility actually depends on.
- **PROD-002:** the JSON-LD price differs from the price visible on the page. Mismatches are a
  merchant policy problem, not a style issue.
- **PROD-003 was dropped.** It would have found near-identical product descriptions with simhash,
  which is exactly what TECH-012 already does across the whole site. A second rule would have
  reported the same pages twice and asked a client to act on one problem in two places.
- The content fixer may draft richer product sections, but only from facts the client supplies
  (specifications, warranty terms, real use cases). Same refusal as the outreach drafter: no fact,
  no draft. A model inventing a product's dimensions is worse than a short page.

### Tier 2: paid data, off by default, behind the budget guard

These follow ADR-0016, ADR-0017 and ADR-0021: one interface per product line, one explicit budget
decorator each, and an honest "not measured" when unconfigured.

#### Prerequisite: DataForSEO is not configured in production

Checked 2026-09-16. The DataForSEO code is built, but the credentials do not reach production, so
everything already built on it is switched off and all of Tier 2 would be too.

DataForSEO is enabled only when both `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` are present
(`dataForSeoFromEnv` in `packages/connectors/src/dataforseo/request.ts`). Two places read them:

| Where it runs | What it powers | State |
|---|---|---|
| Worker, on GitHub Actions (`packages/audit/src/run.ts`) | Referring domains on the authority axis, and AUTH-004 (mentions without a link) | **Wired, 2026-09-21.** `worker.yml` passes `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_USE_SANDBOX` and `BACKLINK_COST_PER_QUERY_USD`. It stays off until the two secrets hold values. |
| API, on Render (`apps/api/src/server.ts`) | `/keywords` and the MCP `keyword_ideas` tool | **Declared, 2026-09-21.** `render.yaml` lists both with `sync: false`; the values are set by hand in the Render dashboard. When absent, the route returns an empty list with a "not configured" note, and the API logs a warning at boot. |

`.env.example` sets `DATAFORSEO_USE_SANDBOX=true`. The sandbox returns fabricated data for free,
which is right for contract tests and demos and wrong for a real audit.

**The password is not the one you log in with.** DataForSEO issues a separate API password at
`app.dataforseo.com/api-access`. The dashboard password fails every call with status 40100, "you
are not authorized to access this resource", which reads like a broken integration rather than
like the wrong string. This cost an attempt on 2026-09-21.

To switch it on:

1. **Worker:** add `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` as repository secrets and
   `BACKLINK_COST_PER_QUERY_USD` as a repository variable, then pass all three in the `env:` block
   of `worker.yml`.
2. **API:** set the same two credentials in the Render dashboard, and declare them in `render.yaml`
   with `sync: false` like the other secrets, so the file stays an accurate list of what the
   service needs.
3. Leave `DATAFORSEO_USE_SANDBOX` unset or `false` in production.
4. Confirm it took: the API boot log no longer warns, `/keywords` returns rows, and the next audit
   shows a referring domain count instead of "not measured".

The values are secrets and never go in the repo, which is public. Spend stays capped per tenant by
the budget guard (ADR-0017), so switching it on cannot produce an open-ended bill.

#### 4. Link gap, classified

**Built, 2026-09-21.** `BacklinkProvider.intersection` in
`packages/connectors/src/backlinks/dataforseo.ts`, classified in `authority/link-gap.ts`, raised as
AUTH-005 and shown on the authority page.

The first live query justified the whole classification step on its own. Against two Kenyan tile
retailers, the vendor returned fifteen domains linking to both and not to the client, and **all
fifteen were link farms** (`60detiknewss.com`, `betwinnermirror.com`, and similar). LinkGap's own
output is this list, unfiltered, emailed as a PDF. Ours refused every one and said so.

- Add `intersection(targets, exclude, limit)` to `BacklinkProvider` and implement it against
  DataForSEO's backlinks domain intersection endpoint through the existing `postTask` in
  `packages/connectors/src/dataforseo/request.ts`. Add it to `backlinks/budgeted.ts`, where the
  compiler forces the decision. Cache results for 30 days in Postgres, keyed by the target set.
- **AUTH-005:** domains that link to at least two of the tracked competitors and not to the client.
  Every domain is classified before it is shown, extending the classifier in
  `packages/connectors/src/authority/mentions.ts`:
  - **Directory or citation source:** moves to the local axis as a citation to claim.
  - **Editorial:** handed to the existing `draftOutreach`, with the client supplying the fact.
  - **Link seller or PBN footprint** (sponsored post pricing, "dofollow" offers, link insertion
    menus): excluded, and counted in the finding as refused so the client can see we saw it. Rule 7.
- Falsification, like AUTH-004: names the slice limit and the vendor's true total, because an
  absence outside the slice is not an absence.
- ADR-0018 still holds. This is a second signal on the authority axis, not a reordering of it.

#### 5. Keyword gap and competitor domain analysis, corrected by Search Console

**Built, 2026-09-21.** `KeywordProvider.gap` against DataForSEO Labs' domain intersection with
`intersections: false`, `subtractKnownQueries` applied above the seam, `GET
/sites/:id/keywords/gap`, and a panel on `/keywords`.

Two things the live run against `tileandcarpet.co.ke` taught:

- The subtraction has to be reported, not assumed. `subtracted: null` (Google not connected) is a
  materially weaker answer than `subtracted: 0`, and the UI says which one it got.
- **Brand terms are left in on purpose.** The real gap list contained "tile and carpet nairobi"
  and "tacc lavington", which are the rival's brand. Filtering brand terms would mean dropping the
  words in the rival's domain, and for a tile retailer those words are "tile" and "carpet", the
  whole category. The page says so instead.

- Add `rankedKeywords(domain)` and `gap(client, competitor)` to `KeywordProvider`, backed by
  DataForSEO Labs' ranked keywords and domain intersection endpoints.
- **Before anything is shown, subtract every query the client already has Search Console
  impressions for.** A vendor's gap list for a small site is mostly the vendor not seeing the site;
  the subtraction is what turns it into a list of real absences. No competitor tool can do this.
- Keep `competition` labelled as an advertising metric, as `keywords/types.ts` already insists. If
  organic difficulty is added, label it as the vendor's estimate.
- CSV export on `/keywords`, and MCP tools `keyword_gap` and `competitor_keywords` next to
  `keyword_ideas` in `apps/mcp/src/tools/read.ts`.

#### 6. Question mining from several sources, feeding AI visibility

**Built, 2026-09-21**, minus the embeddings. `packages/connectors/src/questions/mine.ts` merges
Search Console's question queries (free) with People Also Ask (`SerpProvider.relatedQuestions`,
one billed query, only when a subject is given), groups phrasings on the same deterministic
subject key CONTENT-002 uses, and `GET /sites/:id/questions` serves it. The panel on `/visibility`
turns a selection into tracked prompts, which is the first time that axis has been able to suggest
its own inputs.

**Not built, and deliberately:** the embedding-based clustering. The subject-word key already
collapses phrasings of one question, and a second clustering mechanism here would compete with the
one Tier 3 item 7 needs for the topic map. Geographic scope tagging is also deferred: doing it
honestly needs a gazetteer or the client's own locality, and neither is stored yet.

- Sources, cheapest first:
  - Search Console question queries (item 1): free.
  - People Also Ask (`related_questions`) from SerpApi responses we already pay for.
  - DataForSEO keyword suggestions filtered to questions.
  - Reddit, only through its official OAuth API and only after its own ADR, because its commercial
    terms need reading before we depend on it.
- Group questions with the `embed` role in `packages/llm/src/client.ts`, which exists and has no
  caller, stored in pgvector and clustered deterministically. The `fast` role only names clusters.
- Tag each question with its **geographic scope** (city, region, country). Scope matching is the
  strongest predictor of a stable AI citation, so a question's scope decides which page should
  answer it.
- On `/visibility`, a "suggest prompts" action. Today every tracked prompt is typed by hand; mined
  questions are the obvious seed.

### Tier 3: larger bets, each needing an ADR first

#### 7. Topic map, measured rather than guessed

**Built, 2026-09-21**, under ADR-0024. Pages are embedded (`LLM_EMBED`, which until now had no
caller anywhere in the product), grouped by `clusterByCosine` in `packages/audit/src/cluster.ts`,
and only then named by a `fast` model call whose prompt tells it the grouping is not its to
question. The figure is on the audit page.

The findings listed below are **not built yet**: the map is measured and shown, and it adds no
checks to any axis, because a measurement that raises no advice should not inflate a score.

- Embed each crawled page (title, H1, lead text), cluster deterministically, let the model name the
  clusters, and draw the treemap on the dashboard.
- Findings come from the measurement, not the naming:
  - a cluster with no internal hub page (from the link graph);
  - near-duplicate pages inside one cluster that Search Console confirms are competing (joins
    CONTENT-001);
  - tracked visibility prompts with no matching cluster, which is a content gap stated in the
    client's own terms.
- The ADR has to settle whether embeddings count as measurement under rule 1. The position proposed
  here: yes, because the clustering is deterministic and every finding is confirmed by the link
  graph or Search Console, never by the model's say-so.

#### 8. Public check page: built, 2026-09-21

Shipped under ADR-0025, which amends ADR-0009 to allow exactly one anonymous door. What Rank
Report Card does that we do not: a letter grade out of 100, and the explanations behind an email
gate. What we do that it does not: the eight-axis breakdown, the evidence for every finding, and a
list of what the check could not look at.

Rank Report Card's lesson is that an instant, no-login result is a powerful front door. The plan is
to build one without its grade.

- `/check`: anonymous, single URL (the page plus robots.txt, sitemap and llms.txt), the rule subset
  that works on served HTML, and CrUX origin data. It shows the **eight-axis** pass, warn and fail
  breakdown with evidence for every failure, never one number out of 100.
- Every fixable failure carries "we can open a pull request for this", which leads to sign-in.
- Required before code:
  - An ADR amending ADR-0009, which currently makes the authenticated API the only door.
  - An SSRF guard: reject private and link-local ranges, re-check after every redirect, cap
    response size and time.
  - A per-IP rate limit stored in Postgres, and a per-day global cap.
  - Share URLs that are unguessable, `noindex`, and expire after 30 days.
  - Honesty about the cold start. The API took 33.6 seconds to answer a health check on
    2026-09-16; a page promising "under 60 seconds" has to show what it is waiting for.

#### 9. Contributor opportunities, reframed as mention building

- LinkSeeker's output as a mention-building list rather than a link-building one, because ADR-0018's
  evidence says mentions are the stronger signal.
- SERP footprints per niche and locale, then crawl each guidelines page and apply a deterministic
  link-seller filter (the same one as item 4) before anything is shown.
- Rank by topical match, geographic match, and whether competitors already appear there.
- Drafts only. Nothing sends (rule 6).

#### 10. Competitor watch

- HeyTony's Watchdog, joined to what we already measure: a weekly snapshot diff of competitors'
  titles, meta descriptions, H1s and new sitemap URLs.
- Correlate each change with movement in that competitor's AI citation share, so "they rewrote
  their pricing page" arrives next to "and started being cited for the pricing prompt".
- A weekly cadence is the one schedule the unreliable Actions cron can honour.

---

## 4. What we will not build, and why

| Their feature or advice | Why not |
|---|---|
| A single grade out of 100 | The eight axes move independently; one number hides which one moved. `CLAUDE.md`, domain model. |
| Word-count targets for product and blog pages | Length is not the lever. The lever is one specific, true fact nobody else has. |
| FAQ blocks and FAQPage schema as a tactic | FAQPage rich results were switched off for all sites on 7 May 2026, and about 85% of page-one results already have FAQ blocks, so they do not separate winners. |
| Guest posting as link acquisition | Google's link spam policy names large-scale guest posting for links. Rule 7. Item 9 is mention building, and it refuses link sellers. |
| An LLM deciding what a site is about | Rule 1. Item 7 measures, then names. |
| Emailing a PDF in exchange for an address | Our output is a finding with evidence, and then a pull request. |

---

## 5. Open questions to settle before building

- **DataForSEO in production:** check the Render dashboard for credentials added by hand, then
  follow the switch-on steps in Tier 2's prerequisite. Nothing in Tier 2 can be demonstrated on
  real data until this is done.
- **DataForSEO domain intersection:** confirm the request parameters (target limit, exclusion of the
  client's own domain, intersection mode) and the per-call price against the live documentation,
  and record them in a contract test fixture.
- **Places API (New):** confirm the current free usage terms for an IDs-only Text Search before
  making it the default path in item 2.
- **Reddit API:** read the commercial terms before item 6 depends on it.
- **Vercel Hobby** is for non-commercial use. If `/check` becomes a real acquisition channel, that
  limit and the function timeout both matter to its ADR.
- **The Insiders course:** if its lessons contain something not covered by the public material,
  add it here by hand.

---

## 6. Benchmark

Once any Tier 1 item lands, run a local audit against `rangautiles.com` and put our findings next to
its Rank Report Card result (C, 76/100, 29 passed, 8 warnings, 6 failed). The comparison worth
making is not the count; it is how many of our findings carry a falsification condition and how
many could become a pull request.
