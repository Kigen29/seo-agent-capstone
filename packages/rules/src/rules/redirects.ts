import { normaliseUrl } from '@seo/crawler'
import { httpEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

/**
 * TECH-008: a redirect chain longer than one hop.
 *
 * Every hop is latency the user pays and crawl budget Google spends. One hop is normal
 * and fine. Two or more means somebody redirected a redirect, which usually happens when
 * an old migration was never cleaned up.
 */
export const TECH_008: Rule = {
  id: 'TECH-008',
  axis: 'crawl_health',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: true,
  description: 'A URL redirects more than once before reaching its destination.',

  evaluate: (context) =>
    context.pages
      .filter((page) => page.redirectChain.length > 1 && !isLoop(page.redirectChain, page.finalUrl))
      .map((page) => ({
        title: `${page.url} redirects ${page.redirectChain.length} times before landing`,
        evidence: httpEvidence(page),
        affectedUrls: [page.url, ...page.redirectChain, page.finalUrl],
        confidence: 1,
        estimatedImpact: 20,
        falsification:
          `Request ${page.url} again and count the hops. If it reaches its destination in ` +
          'one hop, this was wrong. After the fix, the chain should collapse to a single ' +
          `redirect straight to ${page.finalUrl}.`,
      })),
}

const isLoop = (chain: readonly string[], finalUrl: string): boolean => {
  const seen = new Set<string>()

  for (const url of chain) {
    const key = normaliseUrl(url) ?? url
    if (seen.has(key)) return true
    seen.add(key)
  }

  return seen.has(normaliseUrl(finalUrl) ?? finalUrl)
}

/**
 * TECH-009: a redirect loop.
 *
 * The page is simply unreachable. Not slow, not deprioritised: gone. This is separated
 * from TECH-008 because the severity is not remotely comparable, and lumping them
 * together would let a critical outage hide inside a list of tidy-up tasks.
 */
export const TECH_009: Rule = {
  id: 'TECH-009',
  axis: 'crawl_health',
  severity: 'critical',
  estimatedEffort: 'small',
  fixable: false,
  description: 'A URL redirects in a loop and can never be reached.',

  evaluate: (context) =>
    context.pages
      .filter(
        (page) =>
          isLoop(page.redirectChain, page.finalUrl) ||
          (page.error ?? '').includes('ERR_TOO_MANY_REDIRECTS'),
      )
      .map((page) => ({
        title: `${page.url} is stuck in a redirect loop`,
        evidence: httpEvidence(page),
        affectedUrls: [page.url, ...page.redirectChain],
        confidence: 1,
        estimatedImpact: 90,
        falsification:
          `Request ${page.url} and follow the redirects. If it terminates at a 200, this ` +
          'was wrong. After the fix, the URL must resolve to a single final destination.',
      })),
}

/**
 * TECH-010: an internal link points at a page that 4xxs or 5xxs.
 *
 * Reported per broken target rather than per broken link, because a 404 linked from
 * forty pages is one problem, not forty. Listing it forty times is how a findings inbox
 * becomes something people close without reading.
 */
export const TECH_010: Rule = {
  id: 'TECH-010',
  axis: 'crawl_health',
  severity: 'high',
  estimatedEffort: 'small',
  fixable: true,
  description: 'An internal link points at a page that returns an error.',

  evaluate: (context) => {
    const broken = context.pages.filter((page) => page.status >= 400)
    if (broken.length === 0) return []

    return broken.flatMap((target) => {
      const targetUrl = normaliseUrl(target.finalUrl) ?? target.finalUrl

      const linkedFrom = context.pages
        .filter((page) =>
          page.extract.links.some(
            (link) =>
              link.internal &&
              link.resolved &&
              (normaliseUrl(link.resolved) ?? link.resolved) === targetUrl,
          ),
        )
        .map((page) => page.finalUrl)

      // A broken page nothing links to is not a broken link. It might be a URL from the
      // sitemap, which is TECH-004's job. Two rules, two different fixes.
      if (linkedFrom.length === 0) return []

      return [
        {
          title: `${linkedFrom.length} page(s) link to ${target.url}, which returns ${target.status}`,
          evidence: httpEvidence(target),
          affectedUrls: [target.url, ...linkedFrom],
          confidence: 1,
          estimatedImpact: 55,
          falsification:
            `Fetch ${target.url}. If it returns 200, this was wrong. After the fix, either ` +
            'the target resolves, or every listed source page no longer links to it. ' +
            'Re-crawling should find zero internal links to a non-200 URL.',
        },
      ]
    })
  },
}
