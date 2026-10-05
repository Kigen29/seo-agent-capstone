# What a standard SEO course teaches, and what the audit checks

A marketer who has taken an introductory SEO course arrives with a checklist. This maps one such syllabus (HeyTony, "Understanding SEO: An Intro To Search Engine Optimization": On-Page, Off-Page and Technical sections, reviewed 2026-10-05 from its slides) onto the rule engine, so it is clear what the audit covers, what it does not yet, and where it deliberately disagrees.

It is a coverage map, not a source of truth. Where a course and a primary source disagree, the primary source wins (see "Facts the agent must never get wrong" in `CLAUDE.md`).

## On-page

| Taught | Checked by | Notes |
|---|---|---|
| Title tag | TECH-011 (shared), TECH-024 (missing), TECH-025 (too long to show) | The course's "limit: 60 characters" is reported as "likely to be cut off". Google cuts by width and enforces no limit. |
| Meta description | TECH-021 (homepage missing), TECH-026 (other pages missing), TECH-027 (shared) | Not a ranking factor; the finding says clickthrough, never position. |
| URL | TECH-030 (spaces, underscores, capitals) | Information only: changing a live address needs a redirect. Length is not checked; Google has no length rule. |
| Content quality | TECH-012 (near-duplicate pages) | Originality and usefulness are not measurable from a crawl, and the coverage note says so. |
| Word count | TECH-029 (under 100 words) | **Disagrees with the course.** It teaches "about 2,000 words, even on the homepage". Google states word count is not a ranking factor, so the rule reports a page that says very little and sets no target. |
| Readability | Not checked, deliberately | Readability formulas are crude and no evidence ties them to rankings. |
| Heading tags | TECH-019 (no h1, or several), TECH-020 (skipped level) | |
| Anchor text | TECH-028 ("click here", "read more") | Internal links only. A linked logo with no text is not counted. |
| Bullets and lists | Not checked, deliberately | About 85% of page-one results already have them, so they do not separate winners from losers. |
| Images | AGENT-004 (missing alt), TECH-034 (heavier than 300 KB) | Sizes come from each image's declared Content-Length, asked for with a HEAD request after the crawl; nothing is downloaded. Reported on the content axis, never as a performance score: whether a site is slow is answered by real visitors' Core Web Vitals. "One image per 200 words" and "avoid stock photos" are not checkable facts. |
| Image alt text | AGENT-004 | Missing only. Whether the text is descriptive is a judgement, not a parse. |
| Video | Not checked | |
| Keyword density | Not checked, deliberately | Does not separate pages that rank from pages that do not, and writing to a density target makes pages worse. |
| Internal links | TECH-010 (broken), TECH-013 (orphans), TECH-014 (click depth) | |
| External links | TECH-031 (dead links to other sites) | Up to 100 distinct links are checked after the crawl, through the egress guard. Only a 404, a 410 or a domain that no longer resolves counts as dead; a site that refuses crawlers or times out is not reported. |

## Off-page

| Taught | Checked by | Notes |
|---|---|---|
| Link building | Authority axis: referring domains, competitor link gap (AUTH rules) | Reported as the second signal. Mentions lead, because they track AI visibility far better than links do. Link farms are refused, never suggested. |
| Content marketing | Search Console checks: questions the site is shown for with no page answering | |
| Local SEO (Business Profile, citations) | LOCAL-001 to LOCAL-004 | Directory citations across the web and the geo-grid are not built. |
| Social media | Counted as self-published mentions, not earned ones | **Disagrees with the course** only in emphasis: a brand's own posts are not authority. |
| Reviews | **Gap** | Not measured. |

## Technical

| Taught | Checked by | Notes |
|---|---|---|
| Site speed, Core Web Vitals | Performance axis, from CrUX field data | Field data, not a Lighthouse score. A site with too little traffic is reported as unmeasured, not guessed. |
| Responsiveness | TECH-032 (no responsive viewport tag), TECH-033 (wider than a phone screen) | The tag is read on every page. Sideways scrolling is measured by rendering a sample of five pages at 375 pixels wide, because a page with a correct tag still overflows if one element has a fixed width. |
| Schema markup | LOCAL-001, PROD-001, PROD-002 | **Disagrees with the course**, which says structured data "will help you rank higher". It makes a page eligible for rich results; it is not a ranking factor. |
| Sitemaps | TECH-003, TECH-004 | |
| Robots.txt | TECH-001, TECH-002 | |
| Crawl depth | TECH-014 | The same three-click threshold the course teaches. |
| Duplicate tags | TECH-011, TECH-027, TECH-019 | |
| Broken links | TECH-010 (internal), TECH-031 (to other sites) | |
| Orphaned pages | TECH-013 | |

## Not in the course, checked here

Canonicals (TECH-006, TECH-007, TECH-023), redirects (TECH-008, TECH-009), soft 404s (TECH-017), pages that only exist after JavaScript runs (TECH-018, TECH-022), mixed content (TECH-015), hreflang (TECH-016), noindex contradictions (TECH-005), AI crawler access (TECH-002), and agent readiness (AGENT-001 to AGENT-003).

## Gaps still open

1. Reviews. Not measured: it needs the Business Profile reviews data, which is a separate integration rather than a missing check.
2. Video. Nothing in the course's advice about it is a checkable fact about a page.
