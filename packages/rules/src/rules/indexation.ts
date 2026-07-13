import { normaliseUrl } from '@seo/crawler'
import { httpEvidence, indexableHtmlPages, markupEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

/**
 * TECH-005: a page is noindexed AND listed in the sitemap.
 *
 * This pairing is the whole rule. A noindex on its own is usually deliberate (a thank-you
 * page, a filtered view), and flagging every one of them would bury the user in noise.
 * But a page that is noindexed AND in the sitemap is the site saying two opposite things
 * at once, and one of them is a mistake. That contradiction is what makes this
 * high-confidence rather than a guess about intent.
 */
export const TECH_005: Rule = {
  id: 'TECH-005',
  axis: 'crawl_health',
  severity: 'high',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'A page is marked noindex but also listed in the sitemap. One of those is wrong.',

  evaluate: (context) => {
    const sitemapSet = new Set(context.sitemapUrls.map((url) => normaliseUrl(url) ?? url))

    return context.pages
      .filter((page) => {
        if (page.status !== 200) return false
        if (!sitemapSet.has(normaliseUrl(page.url) ?? page.url)) return false

        const metaNoindex = !page.extract.metaRobots.index
        const headerNoindex = (page.xRobotsTag ?? '').toLowerCase().includes('noindex')

        return metaNoindex || headerNoindex
      })
      .map((page) => {
        const viaHeader = (page.xRobotsTag ?? '').toLowerCase().includes('noindex')

        return {
          title: `${page.url} is noindexed but is in the sitemap`,
          evidence: viaHeader
            ? httpEvidence(page)
            : markupEvidence(page, 'meta[name="robots"]', page.extract.metaRobots.raw ?? ''),
          affectedUrls: [page.url],
          confidence: 0.95,
          estimatedImpact: 75,
          falsification:
            `Re-fetch ${page.url} and check both the robots meta tag and the X-Robots-Tag ` +
            'header. If neither says noindex, this was wrong. After the fix, Search Console ' +
            'URL Inspection should report the page as indexable, and it should appear in the ' +
            'index within a few weeks. If it stays out, the cause was not the noindex.',
        }
      })
  },
}

/** TECH-006: an indexable page with no canonical tag. */
export const TECH_006: Rule = {
  id: 'TECH-006',
  axis: 'crawl_health',
  severity: 'low',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'An indexable page declares no canonical URL.',

  evaluate: (context) =>
    indexableHtmlPages(context.pages)
      .filter((page) => page.extract.canonical === null)
      .map((page) => ({
        title: `${page.url} has no canonical tag`,
        evidence: markupEvidence(page, 'link[rel="canonical"]', ''),
        affectedUrls: [page.url],
        confidence: 1,
        // Missing canonical is only a real problem where duplicates exist. On a site with
        // no parameterised URLs it is housekeeping, not an emergency. Severity: low.
        estimatedImpact: 25,
        falsification:
          `Re-fetch ${page.url} and look for link[rel="canonical"] in the head. If one is ` +
          'present, this was wrong. Note that adding a self-referencing canonical will not ' +
          'move rankings on its own; it only matters once duplicate URLs exist.',
      })),
}

/**
 * TECH-007: a canonical tag points at a URL that is not a live, indexable page.
 *
 * This is worse than a missing canonical. It actively tells Google "index that page
 * instead of this one", and if that page 404s or redirects, the instruction is garbage
 * and Google has to guess. A canonical pointing to a 404 can deindex a working page.
 */
export const TECH_007: Rule = {
  id: 'TECH-007',
  axis: 'crawl_health',
  severity: 'high',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'A canonical tag points at a page that 404s or redirects.',

  evaluate: (context) => {
    const byUrl = new Map(context.pages.map((page) => [normaliseUrl(page.url) ?? page.url, page]))

    return context.pages.flatMap((page) => {
      const canonical = page.extract.canonical
      if (page.status !== 200 || !canonical) return []

      const target = byUrl.get(normaliseUrl(canonical) ?? canonical)

      // A canonical pointing somewhere we never crawled is not evidence of a problem.
      // It could be a perfectly good page on another host. Silence is the honest answer.
      if (!target) return []

      const broken = target.status >= 300 || target.redirectChain.length > 0
      if (!broken) return []

      const problem =
        target.redirectChain.length > 0
          ? `redirects to ${target.finalUrl}`
          : `returns ${target.status}`

      return [
        {
          title: `${page.url} declares a canonical that ${problem}`,
          evidence: httpEvidence(target),
          affectedUrls: [page.url, canonical],
          confidence: 1,
          estimatedImpact: 70,
          falsification:
            `Fetch the canonical target ${canonical} directly. If it returns 200 and does ` +
            'not redirect, this was wrong. After the fix, Search Console URL Inspection ' +
            'should show "Google-selected canonical" matching the declared canonical.',
        },
      ]
    })
  },
}
