import { normaliseUrl } from '@seo/crawler'
import { httpEvidence, siteEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

const now = (context: { pages: { fetchedAt: string }[] }) =>
  context.pages[0]?.fetchedAt ?? new Date().toISOString()

/** TECH-003: no XML sitemap, or one that robots.txt never points at. */
export const TECH_003: Rule = {
  id: 'TECH-003',
  axis: 'crawl_health',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: true,
  description: 'robots.txt does not declare a sitemap, so crawlers have to guess.',

  evaluate: (context) => {
    if (context.robots.sitemaps.length > 0) return []

    return [
      {
        title: 'No sitemap is declared in robots.txt',
        evidence: siteEvidence(
          context.seed,
          '/robots.txt',
          context.robots.absent
            ? 'There is no robots.txt at all, so no sitemap is declared.'
            : 'robots.txt exists but contains no Sitemap: directive.',
          now(context),
        ),
        affectedUrls: [context.seed],
        confidence: 1,
        // A sitemap is a discovery aid, not a ranking factor. It matters most for large
        // sites and for pages with few internal links. Saying otherwise would be a lie.
        estimatedImpact: 35,
        falsification:
          'Fetch /robots.txt and look for a Sitemap: line. If one is present, this was wrong. ' +
          'After the fix, Search Console should report the sitemap as discovered and show a ' +
          'non-zero count of discovered URLs.',
      },
    ]
  },
}

/**
 * TECH-004: the sitemap lists URLs that are not indexable.
 *
 * A sitemap is a statement: "these are my canonical, indexable pages." Listing a 404, a
 * redirect, or a noindexed page contradicts that statement, wastes crawl budget, and
 * costs trust in the sitemap as a whole.
 */
export const TECH_004: Rule = {
  id: 'TECH-004',
  axis: 'crawl_health',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: true,
  description: 'The sitemap lists URLs that 404, redirect, or are noindexed.',

  evaluate: (context) => {
    const sitemapSet = new Set(context.sitemapUrls.map((url) => normaliseUrl(url) ?? url))

    const offenders = context.pages.filter((page) => {
      const url = normaliseUrl(page.url) ?? page.url
      if (!sitemapSet.has(url)) return false

      const noindex =
        !page.extract.metaRobots.index || (page.xRobotsTag ?? '').toLowerCase().includes('noindex')

      return page.status >= 300 || page.redirectChain.length > 0 || noindex
    })

    return offenders.map((page) => {
      const noindex = !page.extract.metaRobots.index
      const redirected = page.redirectChain.length > 0

      const problem = redirected
        ? `redirects to ${page.finalUrl}`
        : noindex
          ? 'is marked noindex'
          : `returns ${page.status}`

      return {
        title: `Sitemap lists ${page.url}, which ${problem}`,
        evidence: httpEvidence(page),
        affectedUrls: [page.url],
        confidence: 1,
        estimatedImpact: 30,
        falsification:
          `Re-fetch ${page.url}. If it returns 200, is not a redirect, and is indexable, ` +
          'this finding was wrong. After the fix, the sitemap should contain only 200-status ' +
          'canonical URLs, and Search Console should stop reporting them as excluded.',
      }
    })
  },
}
