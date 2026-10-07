import { normaliseUrl } from '@seo/crawler'
import { httpEvidence, indexableHtmlPages, markupEvidence } from '../evidence.js'
import type { CrawledPage } from '@seo/crawler'
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

/**
 * TECH-006: an indexable page with no canonical tag.
 *
 * **No static tag can fix this, which is why there is no deterministic fixer for it.** The
 * repository-reading agent (ADR-0030) can: it derives the canonical from the current route in
 * whatever shared head component the site has, which is a change to logic, not the insertion of
 * a tag. The reasoning below is why the simple version is refused and what a reviewer should check.
 *
 * A canonical has to be self-referencing per page, and every file the fixers can write a head tag
 * into is a *shared layout*: `app/layout.tsx`, `header.php`, `baseof.html`, a SPA's single
 * `index.html`. A static `<link rel="canonical">` in any of those gives every route the same
 * canonical, which tells Google the whole site is a duplicate of one page. That is materially
 * worse than the missing tag this rule is reporting.
 *
 * Next.js is the one place a framework API looked like an escape, and it is not: its docs are
 * explicit that a relative `alternates.canonical` resolves against `metadataBase`, not against the
 * current pathname, so `'./'` in a root layout yields the site root on every route. There is no
 * static value that self-references.
 *
 * A per-route fix is correct and is what a human should write; it needs to map a URL to the source
 * file that renders it, which the repo reader cannot do (it fetches known paths and cannot list a
 * directory, which is why HEAD_FILES is a hand-written list). Template-expression canonicals are
 * the one deterministic path that would work for Hugo, Jekyll, WordPress and Astro, and they are
 * site-wide, so they are only safe once the rule can say that *every* indexable page lacks a
 * canonical rather than emitting one finding per page. See ADR-0022.
 */
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
          'move rankings on its own; it only matters once duplicate URLs exist. ' +
          'The agent can propose this in a pull request. When you review it, check that each ' +
          'page ends up naming its own URL: a single static tag in a shared layout would point ' +
          'every page at the same address, which is worse than the missing tag.',
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

    /**
     * One finding per document, not per address it was reached by.
     *
     * A site that redirects its apex to `www` is crawled at both: the sitemap lists one, links
     * use the other, and each arrives as its own page record with the same final URL and the same
     * canonical tag. Keyed on `page.url`, every affected page was raised twice, so eight pages
     * with one cause filled sixteen rows of the inbox.
     */
    const seen = new Set<string>()

    return context.pages.flatMap((page) => {
      const canonical = page.extract.canonical
      if (page.status !== 200 || !canonical) return []

      const document = normaliseUrl(page.finalUrl) ?? page.finalUrl
      if (seen.has(document)) return []

      const target = byUrl.get(normaliseUrl(canonical) ?? canonical)

      // A canonical pointing somewhere we never crawled is not evidence of a problem.
      // It could be a perfectly good page on another host. Silence is the honest answer.
      if (!target) return []

      const broken = target.status >= 300 || target.redirectChain.length > 0
      if (!broken) return []

      seen.add(document)

      // Names the canonical as well as where it leads. "X declares a canonical that redirects to
      // X" was a true sentence that read as nonsense, because the address in between was missing.
      const title =
        target.redirectChain.length > 0
          ? `${page.finalUrl} declares the canonical ${canonical}, which redirects to ${target.finalUrl}`
          : `${page.finalUrl} declares the canonical ${canonical}, which returns ${target.status}`

      return [
        {
          title,
          evidence: httpEvidence(target),
          affectedUrls: [page.finalUrl, canonical],
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

/**
 * How many distinct pages must share one foreign canonical before it is a site-wide mistake.
 *
 * Two can be deliberate (a print view and its article). Three different paths all naming the same
 * other page is the signature of one static tag in a shared layout or `index.html`, which is the
 * failure TECH-006 explains it cannot fix for exactly this reason.
 */
export const SHARED_CANONICAL_MIN_PAGES = 3

/**
 * TECH-023: many different pages declare the same canonical, pointing away from themselves.
 *
 * Worse than TECH-007 and far worse than a missing canonical: each of these pages tells Google
 * "I am a copy of that page, index it instead", so Google is being asked to drop every one of
 * them. Seen on a real single-page app whose `index.html` carried the homepage's canonical, so all
 * 34 routes named the homepage. One finding for the site, not one per page, because it is one tag.
 *
 * Query-string variants of the target are excluded: `/shoes?sort=price` naming `/shoes` is correct.
 */
export const TECH_023: Rule = {
  id: 'TECH-023',
  axis: 'crawl_health',
  severity: 'critical',
  estimatedEffort: 'small',
  // Fixable only by the repository-reading agent (ADR-0030): the fix is a canonical derived from
  // the current route, which no static edit to a shared head file can express.
  fixable: true,
  description: 'Many different pages declare the same canonical, pointing at another page.',

  evaluate: (context) => {
    const pathOf = (url: string): string | null => {
      try {
        const parsed = new URL(url)
        return `${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '') || '/'}`
      } catch {
        return null
      }
    }

    // One entry per final page: two crawled addresses that land on the same page count once.
    const pages = new Map<string, CrawledPage>()
    for (const page of indexableHtmlPages(context.pages)) {
      const key = pathOf(page.finalUrl)
      if (key && !pages.has(key)) pages.set(key, page)
    }

    const byTarget = new Map<string, CrawledPage[]>()
    for (const [path, page] of pages) {
      const canonical = page.extract.canonical
      if (!canonical) continue
      const target = pathOf(canonical)
      if (!target || target === path) continue
      byTarget.set(target, [...(byTarget.get(target) ?? []), page])
    }

    return [...byTarget.values()]
      .filter((group) => group.length >= SHARED_CANONICAL_MIN_PAGES)
      .map((group) => {
        const canonical = group[0]!.extract.canonical!
        return {
          title: `${group.length} different pages all declare ${canonical} as their canonical`,
          evidence: markupEvidence(
            group[0]!,
            'link[rel="canonical"]',
            `<link rel="canonical" href="${canonical}">`,
          ),
          affectedUrls: group.map((page) => page.finalUrl),
          // About the page they all point at, not the first of the pages pointing.
          subject: canonical,
          confidence: 0.95,
          estimatedImpact: 95,
          falsification:
            `Re-fetch ${group[0]!.finalUrl} and ${group[1]!.finalUrl}. If each declares a ` +
            'canonical pointing at itself, or none, this was wrong. After the fix, Search ' +
            'Console URL Inspection for one of them should show a user-declared canonical ' +
            "matching that page, and the Pages report should stop listing them as 'Alternate " +
            "page with proper canonical tag'.",
        }
      })
  },
}
