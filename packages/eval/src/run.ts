import type { Finding } from '@seo/core'
import {
  buildLinkGraph,
  compareRenders,
  evaluateAiCrawlerPosture,
  extractPage,
  parseRobotsTxt,
  toGraphPages,
  type CrawledPage,
} from '@seo/crawler'
import { runRules } from '@seo/rules'
import type { GoldenCase, GoldenPage } from './dataset.js'
import { scoreCase, type CaseResult } from './metrics.js'

/**
 * Run the rule engine over a golden case, the way an audit would.
 *
 * The context is assembled with the same calls, in the same order, as
 * `packages/audit/src/run.ts`. That similarity is the point and is worth guarding: a harness that
 * builds its own context grades a system that does not ship. If `runAudit` starts passing
 * something new, this is wrong until it does too, and the symptom would be an evaluation that
 * quietly stops covering whatever the new field feeds.
 *
 * Nothing here touches the network. A case carries the bytes it was captured with, so the number
 * this produces is a fact about the engine rather than about what a live site did today.
 */
export function findingsFor(golden: GoldenCase): Finding[] {
  const pages = golden.pages.map((page) => toCrawledPage(page, golden))

  return runRules({
    siteId: golden.id,
    seed: golden.seed,
    pages,
    robots: parseRobotsTxt(golden.robotsTxt),
    posture: evaluateAiCrawlerPosture(parseRobotsTxt(golden.robotsTxt)),
    llmsTxt: golden.llmsTxt,
    sitemapUrls: golden.sitemapUrls,
    graph: buildLinkGraph(toGraphPages(pages), { seed: golden.seed }),
    skipped: [],
  })
}

export function evaluate(golden: GoldenCase): CaseResult {
  return scoreCase(golden, findingsFor(golden))
}

/**
 * Turn stored bytes into the shape the crawler would have produced.
 *
 * `preJsHtml` and `renderedHtml` are the same string, because a captured case has no browser to
 * run. That is a real limitation and worth naming rather than hiding: TECH-018 asks whether a page
 * renders without JavaScript, and against this dataset it can never fire. A case can still label
 * it, and the resulting false negative is honest; what it must not do is quietly count as a pass.
 * Capturing a rendered snapshot alongside the raw HTML would lift it, and is the obvious next
 * extension of the format.
 */
function toCrawledPage(page: GoldenPage, golden: GoldenCase): CrawledPage {
  const extract = extractPage(page.html, page.url)

  return {
    url: page.url,
    finalUrl: page.url,
    status: page.status,
    headers: page.headers,
    redirectChain: [],
    depth: page.url === golden.seed ? 0 : 1,
    fetchedAt: golden.capturedAt,
    preJsHtml: page.html,
    renderedHtml: page.html,
    extract,
    render: compareRenders(page.html, page.html, page.url),
    xRobotsTag: page.headers['x-robots-tag'] ?? null,
  }
}
