import type { Finding } from '@seo/core'
import {
  acceptLlmsTxt,
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
    // The case stores what the server sent. The product decides whether that is an llms.txt.
    llmsTxt: acceptLlmsTxt(golden.llmsTxt),
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
 * A case captured with a browser stores the rendered DOM beside the served HTML, and the two are
 * compared exactly as the crawler compares them, so TECH-018 (renders nothing until JavaScript
 * runs) and everything that only exists after rendering can be graded. A case captured with plain
 * fetch has only the served HTML: both strings are then the same and TECH-018 cannot fire on it,
 * which is an honest false negative if the case labels it.
 */
function toCrawledPage(page: GoldenPage, golden: GoldenCase): CrawledPage {
  // The crawler extracts from the rendered DOM and compares it with the served HTML. A case
  // captured with a browser carries both; one captured with fetch has only the served HTML.
  const rendered = page.renderedHtml ?? page.html
  const extract = extractPage(rendered, page.url)

  return {
    url: page.url,
    finalUrl: page.url,
    status: page.status,
    headers: page.headers,
    redirectChain: [],
    depth: page.url === golden.seed ? 0 : 1,
    fetchedAt: golden.capturedAt,
    preJsHtml: page.html,
    renderedHtml: rendered,
    extract,
    render: compareRenders(page.html, rendered, page.url),
    xRobotsTag: page.headers['x-robots-tag'] ?? null,
  }
}
