import { describe, expect, it } from 'vitest'
import {
  ALLOW_ALL,
  buildLinkGraph,
  compareRenders,
  evaluateAiCrawlerPosture,
  extractPage,
  Frontier,
  parseRobotsTxt,
  toGraphPages,
  type CrawledPage,
  type CrawlResult,
} from '@seo/crawler'
import { runRules } from '@seo/rules'
import { checkDeployedFixes } from '../src/fix-checks.js'
import { reconcileFixVerifications } from '../src/verify-fixes.js'

const seed = 'https://example.com/'
function page(head = '', url = seed): CrawledPage {
  const html = `<html><head>${head}</head><body><main>Example business</main></body></html>`
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    redirectChain: [],
    depth: 0,
    fetchedAt: new Date().toISOString(),
    preJsHtml: html,
    renderedHtml: html,
    extract: extractPage(html, url),
    render: compareRenders(html, html, url),
  }
}
function crawl(pages = [page()]): CrawlResult {
  const robots = parseRobotsTxt('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml')
  return {
    pages,
    resources: { robots: true, llmsTxt: true, sitemaps: true },
    robots,
    posture: evaluateAiCrawlerPosture(robots),
    llmsTxt: '# Example',
    sitemapUrls: [seed],
    sitemapOnlyUrls: [],
    skipped: [],
    state: new Frontier(seed).toState(),
  }
}
function check(ruleId: string, result: CrawlResult, urls = [seed]) {
  const profile = { cid: '42' }
  const current = runRules({
    ...result,
    siteId: 'site',
    seed,
    businessProfile: profile,
    graph: buildLinkGraph(toGraphPages(result.pages), { seed }),
  })
  return checkDeployedFixes(result, [{ id: 'fix', ruleId, affectedUrls: urls }], current, profile)
    .fix
}

describe('positive checks of every offered fix', () => {
  it.each(['TECH-002', 'TECH-003', 'TECH-004', 'TECH-005', 'TECH-015', 'TECH-022', 'AGENT-001'])(
    '%s verifies a measured successful change',
    (rule) => {
      expect(check(rule, crawl())).toBe('verified')
    },
  )
  it('verifies a canonical target without requiring the old redirect to be repaired', () => {
    const old = { ...page('', seed + 'old'), finalUrl: seed, redirectChain: [seed + 'old'] }
    expect(
      check('TECH-007', crawl([page(`<link rel="canonical" href="${seed}">`), old]), [
        seed,
        seed + 'old',
      ]),
    ).toBe('verified')
  })
  it('does not verify a canonical removed rather than repaired, or an unfetched target', () => {
    expect(check('TECH-007', crawl())).toBe('rejected')
    expect(
      check('TECH-007', crawl([page('<link rel="canonical" href="https://other.example/">')])),
    ).toBe('inconclusive')
  })
  it.each(['LOCAL-001', 'LOCAL-002'])('%s requires the actual business markup', (rule) => {
    expect(check(rule, crawl())).toBe('rejected')
    const data = {
      '@type': 'LocalBusiness',
      hasMap: 'https://maps.google.com/?cid=42',
      sameAs: ['https://maps.google.com/?cid=42'],
    }
    expect(
      check(
        rule,
        crawl([page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`)]),
      ),
    ).toBe('verified')
  })
  it('checks description content even when the diagnostic homepage precondition changes', () => {
    expect(check('TECH-021', crawl())).toBe('rejected')
    expect(
      check('TECH-021', crawl([page('<meta name="description" content="A real description">')])),
    ).toBe('verified')
  })
  it('never treats failed root fetches as evidence of success', () => {
    const result = crawl()
    result.resources = { robots: false, llmsTxt: false, sitemaps: false }
    for (const rule of ['TECH-002', 'TECH-003', 'TECH-004', 'AGENT-001'])
      expect(check(rule, result)).toBe('inconclusive')
  })
  it('rejects blocked crawlers and missing root resources after successful fetches', () => {
    const result = crawl()
    result.robots = parseRobotsTxt('User-agent: OAI-SearchBot\nDisallow: /')
    result.posture = evaluateAiCrawlerPosture(result.robots)
    result.llmsTxt = null
    for (const rule of ['TECH-002', 'TECH-003', 'AGENT-001'])
      expect(check(rule, result)).toBe('rejected')
  })
  it('verifies removal from a complete sitemap even if the old page still 404s', () => {
    const result = crawl([{ ...page(), status: 404 }])
    result.sitemapUrls = []
    expect(check('TECH-004', result)).toBe('verified')
    result.resources!.sitemaps = false
    expect(check('TECH-004', result)).toBe('inconclusive')
  })
  it('rejects unsuccessful noindex and SPA fixes, without confusing failure with missing coverage', () => {
    expect(check('TECH-005', crawl([page('<meta name="robots" content="noindex">')]))).toBe(
      'rejected',
    )
    expect(check('TECH-022', crawl([{ ...page(), status: 404 }]))).toBe('rejected')
    expect(check('TECH-022', crawl([{ ...page(), status: 503 }]))).toBe('inconclusive')
  })
  it('rejects remaining mixed content and refuses to verify an unfetched page', () => {
    expect(
      check('TECH-015', crawl([page('<script src="http://example.com/a.js"></script>')])),
    ).toBe('rejected')
    expect(check('TECH-015', crawl([]))).toBe('inconclusive')
  })
  it('never accepts a positive check without deployment evidence', () => {
    const ref = { id: 'fix', ruleId: 'TECH-005', affectedUrls: [seed] }
    const result = reconcileFixVerifications([ref], [], {
      checks: { fix: 'verified' },
      successfulUrls: [seed],
      evaluatedRuleIds: ['TECH-005'],
      deploymentConfirmed: false,
    })
    expect(result.get('fix')).toBe('inconclusive')
  })
  it('does not infer root coverage from an allow-all parser fallback', () => {
    const result = crawl()
    result.robots = ALLOW_ALL
    delete result.resources
    expect(check('TECH-002', result)).toBe('inconclusive')
  })
})
