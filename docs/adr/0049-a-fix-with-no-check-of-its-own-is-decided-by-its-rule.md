# ADR-0049: A fix with no check of its own is decided by the rule that found it

- Status: Accepted; extends ADR-0047
- Date: 2026-10-11

## Context

ADR-0047 let a merged fix be decided from the live site. The first run of it in production decided two of three fixes on one site and left the third saying the pages "could not be read completely". They had been read. The third was a fix for TECH-023, forty-eight pages declaring one canonical, and it could not have been decided however the crawl went.

Verification has two ways to judge a fix. Eleven rules have a purpose-built check: fetch `llms.txt` and see that it is not empty, confirm a page is now indexable. For every other rule the intended fallback was to run the rule again over the pages it flagged and see whether it still fires.

The fallback was unreachable. The purpose-built checks returned `inconclusive` for a rule they did not know, the same value they return when a check runs and cannot tell. And when checks were present at all, which was always during verification, they were the only thing consulted. So a fix for any rule outside the eleven was undecidable for good, deployment report or not: shared canonicals, shared titles, missing titles and descriptions, heading order, missing alt text, missing language, about a dozen rules a pull request can be opened for.

Separately, a verification crawl read at most fifty pages. A fix across more pages than that could not be fully covered.

## Decision

**1. No check is not the same as an inconclusive check.** `checkDeployedFixes` returns no entry for a rule it has no check for. An entry of `inconclusive` now only ever means a check ran and could not tell.

**2. A finding with no entry is decided by its own rule.** If the rule ran again over the same pages, every one of those pages was fetched and is indexable, and the rule did not fire on any of them, the fix is verified. If it fired on any, the problem is still there.

**3. Only rules that can be judged from their own pages are decided this way.** `RECHECKABLE_RULES` lists them: rules whose verdict depends on the HTML of the pages they flagged. A page's canonical, title, description, headings, language, images and markup qualify, and so do group rules such as "these pages share a title", which are decided by the pages in the group.

**4. A verification crawl reads as many pages as the fixes cover**, plus ten, with a floor of fifty and a ceiling of two hundred.

Everything in ADR-0047 applies unchanged on top: with no deployment report a success is decided at once, and a failure only once the merge has settled.

## What is still never decided this way

- **Rules about the link graph**: orphan pages, click depth, broken internal links. Whether a page is an orphan depends on every other page, and a verification crawl does not read them all.
- **Rules a verification crawl does not measure**: dead outbound links and the phone-width render, both skipped to keep the crawl small.
- **A page that was not fetched, or is no longer indexable.** Coverage is checked per finding, and one missing page leaves it undecided.

A fix for one of those stays undecided, and says so. That is the old behaviour, now applied only where it is true.

## Consequences

- **About a dozen more kinds of fix can close their loop.** Before this they were merged and never resolved.
- **The fallback is weaker evidence than a purpose-built check.** A check asserts the promised change is present. The fallback asserts the original complaint is absent. For the rules listed those are the same thing, which is the criterion for being listed.
- **A fix across more than about 190 pages cannot be decided**, because the crawl stops at two hundred. It stays undecided and is checked again daily. Raising the ceiling is a cost decision.
- **Adding a fixable rule now means deciding which list it belongs to.** A rule in neither has fixes that never resolve, which is the fault this record exists to prevent.
