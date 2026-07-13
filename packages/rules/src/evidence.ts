import type { Evidence } from '@seo/core'
import type { CrawledPage, GraphNode } from '@seo/crawler'

/**
 * Evidence builders. Every finding must carry a machine-verifiable observation, so these
 * exist to make the correct thing the easy thing: a rule reaches for one of these rather
 * than hand-rolling a bag of strings.
 */

export const httpEvidence = (page: CrawledPage): Evidence => ({
  kind: 'http',
  observedAt: page.fetchedAt,
  source: 'crawler',
  url: page.finalUrl,
  status: page.status,
  redirectChain: page.redirectChain,
  headers: page.headers,
})

export const markupEvidence = (page: CrawledPage, locator: string, snippet: string): Evidence => ({
  kind: 'markup',
  observedAt: page.fetchedAt,
  source: 'crawler',
  url: page.finalUrl,
  locator,
  snippet,
})

export const graphEvidence = (page: CrawledPage, node: GraphNode): Evidence => ({
  kind: 'graph',
  observedAt: page.fetchedAt,
  source: 'crawler',
  url: node.url,
  inboundInternalLinks: node.inboundCount,
  clickDepth: node.clickDepth,
})

export const metricEvidence = (
  page: CrawledPage,
  metric: string,
  value: number,
  unit: 'ms' | 's' | 'score' | 'count' | 'ratio' | 'percent',
): Evidence => ({
  kind: 'metric',
  observedAt: page.fetchedAt,
  source: 'crawler',
  metric,
  value,
  unit,
  url: page.finalUrl,
})

/** Evidence for a finding about the site as a whole, not about one page. */
export const siteEvidence = (
  seed: string,
  locator: string,
  snippet: string,
  observedAt: string,
): Evidence => ({
  kind: 'markup',
  observedAt,
  source: 'crawler',
  url: seed,
  locator,
  snippet,
})

/**
 * The pages a rule about on-page SEO should actually look at.
 *
 * A 404, a redirect, or a page the site has told Google not to index is not a page with
 * an SEO problem. Running title and heading rules over them produces a mountain of
 * findings nobody should act on, and that is how an audit tool gets closed and ignored.
 */
export const indexableHtmlPages = (pages: readonly CrawledPage[]): CrawledPage[] =>
  pages.filter(
    (page) =>
      page.status === 200 &&
      !page.error &&
      page.extract.metaRobots.index &&
      !(page.xRobotsTag ?? '').toLowerCase().includes('noindex'),
  )
