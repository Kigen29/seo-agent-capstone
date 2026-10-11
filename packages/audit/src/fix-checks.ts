import { normaliseUrl, type CrawledPage, type CrawlResult } from '@seo/crawler'
import { flattenNodes, isLocalBusiness, linksToProfile } from '@seo/rules'
import type { Finding } from '@seo/core'
import { stillPresent, type FixVerdict, type MergedFindingRef } from './verify-fixes.js'

const key = (url: string) => normaliseUrl(url) ?? url
const readable = (page: CrawledPage | undefined): page is CrawledPage =>
  !!page && !page.error && page.status === 200
const indexable = (page: CrawledPage) =>
  page.extract.metaRobots.index && !(page.xRobotsTag ?? '').toLowerCase().includes('noindex')
const verdict = (passed: boolean): FixVerdict => (passed ? 'verified' : 'rejected')

/**
 * Positive checks of the promised change, for the rules that have one.
 *
 * A rule with no check here gets no entry in the result, which is different from an entry saying
 * "inconclusive". Inconclusive means the check ran and could not tell: the page was unreachable,
 * the file could not be read. No entry means there is no purpose-built check, and the caller
 * falls back to running the rule that found the problem (ADR-0049).
 *
 * They used to be the same value, and that made every fix for a rule not listed below
 * undecidable for good, with or without a deployment report: about a dozen fixable rules,
 * shared canonicals and missing alt text among them.
 */
export function checkDeployedFixes(
  crawl: CrawlResult,
  refs: readonly MergedFindingRef[],
  current: readonly Finding[],
  profile?: { cid?: string | null },
): Record<string, FixVerdict> {
  const byUrl = new Map<string, CrawledPage>()
  for (const page of crawl.pages) {
    byUrl.set(key(page.url), page)
    if (!byUrl.has(key(page.finalUrl))) byUrl.set(key(page.finalUrl), page)
  }
  const sitemap = new Set(crawl.sitemapUrls.map(key))
  const check = (ref: MergedFindingRef): FixVerdict | undefined => {
    if (!ref.affectedUrls.length) return 'inconclusive'
    const pages = ref.affectedUrls.map((url) => byUrl.get(key(url)))
    switch (ref.ruleId) {
      case 'TECH-002':
      case 'TECH-003':
        return crawl.resources?.robots ? verdict(!stillPresent(ref, current)) : 'inconclusive'
      case 'AGENT-001':
        return crawl.resources?.llmsTxt ? verdict(!!crawl.llmsTxt?.trim()) : 'inconclusive'
      case 'TECH-004': {
        // A removed sitemap entry needs no successful fetch of the deleted URL.
        if (!crawl.resources?.sitemaps || !crawl.robots.sitemaps.length) return 'inconclusive'
        const listed = ref.affectedUrls.filter((url) => sitemap.has(key(url)))
        const targets = listed.map((url) => byUrl.get(key(url)))
        if (targets.some((page) => !page || page.error || page.status === 0 || page.status >= 500))
          return 'inconclusive'
        return verdict(
          targets.every(
            (page) => readable(page) && page.redirectChain.length === 0 && indexable(page),
          ),
        )
      }
      case 'TECH-007': {
        // The first URL is the declaring page; the old target may legitimately still redirect.
        const source = pages[0]
        if (!readable(source)) return 'inconclusive'
        if (!source.extract.canonical) return 'rejected'
        const target = byUrl.get(key(source.extract.canonical))
        if (!target || target.error || !target.status || target.status >= 500) return 'inconclusive'
        return verdict(
          readable(target) &&
            (target.redirectChain.length === 0 ||
              key(target.finalUrl) === key(source.extract.canonical)) &&
            indexable(target),
        )
      }
      case 'TECH-022':
        if (pages.some((page) => !page || page.error || !page.status || page.status >= 500))
          return 'inconclusive'
        return verdict(pages.every((page) => readable(page) && page.redirectChain.length === 0))
      case 'LOCAL-001':
      case 'LOCAL-002': {
        if (!pages.every(readable)) return 'inconclusive'
        if (ref.ruleId === 'LOCAL-002' && !profile?.cid) return 'inconclusive'
        return verdict(
          pages.every((page) => {
            const business = flattenNodes(page.extract.jsonLd).find(isLocalBusiness)
            return (
              !!business &&
              (ref.ruleId === 'LOCAL-001' ||
                (linksToProfile(business['hasMap'], profile!.cid!) &&
                  linksToProfile(business['sameAs'], profile!.cid!)))
            )
          }),
        )
      }
      case 'TECH-005':
        return pages.every(readable) ? verdict(pages.every(indexable)) : 'inconclusive'
      case 'TECH-021':
        return pages.every(readable) && pages.every(indexable)
          ? verdict(pages.every((page) => !!page.extract.metaDescription?.trim()))
          : 'inconclusive'
      case 'TECH-015':
        // These diagnostic rules only run on indexable pages. Noindex must not hide a failure.
        if (!pages.every(readable) || !pages.every(indexable)) return 'inconclusive'
        return verdict(
          pages.every((page) =>
            page.extract.resources.every(
              (resource) => !(resource.resolved ?? resource.url).startsWith('http://'),
            ),
          ),
        )
      default:
        return undefined
    }
  }
  return Object.fromEntries(
    refs.flatMap((ref) => {
      const result = check(ref)
      return result === undefined ? [] : [[ref.id, result]]
    }),
  )
}
