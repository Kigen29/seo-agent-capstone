import { indexableHtmlPages, markupEvidence, metricEvidence } from '../evidence.js'
import { hammingDistance, simhash } from '../simhash.js'
import type { Rule } from '../types.js'

/**
 * TECH-011: two indexable pages share a title.
 *
 * Only indexable pages count. Duplicate titles across noindexed or redirecting pages are
 * nobody's problem, and reporting them is how you teach a user to ignore you.
 */
export const TECH_011: Rule = {
  id: 'TECH-011',
  axis: 'content',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: true,
  description: 'Several indexable pages share the same title tag.',

  evaluate: (context) => {
    const byTitle = new Map<string, string[]>()

    for (const page of indexableHtmlPages(context.pages)) {
      const title = page.extract.title
      if (!title) continue // that is TECH-019 territory, not this rule's

      byTitle.set(title, [...(byTitle.get(title) ?? []), page.finalUrl])
    }

    return [...byTitle.entries()]
      .filter(([, urls]) => urls.length > 1)
      .map(([title, urls]) => {
        const first = context.pages.find((page) => page.finalUrl === urls[0])

        return {
          title: `${urls.length} pages share the title "${title}"`,
          evidence: first
            ? markupEvidence(first, 'title', title)
            : metricEvidence(context.pages[0] as never, 'duplicate_titles', urls.length, 'count'),
          affectedUrls: urls,
          confidence: 1,
          estimatedImpact: 40,
          falsification:
            'Re-crawl and group indexable pages by title. If no title appears twice, this ' +
            'was wrong. After the fix, each of these URLs should carry a distinct title. ' +
            'Note this fixes a cannibalisation risk; it does not by itself guarantee a ' +
            'ranking change.',
        }
      })
  },
}

/**
 * TECH-012: near-duplicate content across pages.
 *
 * Uses SimHash rather than exact hashing, because two pages that differ only in a price
 * or a city name are duplicates in Google's eyes and hash completely differently.
 *
 * The distance threshold is deliberately tight. A false positive here accuses someone of
 * duplicating their own content, which is both insulting and expensive to act on, so the
 * bar is "these are essentially the same document", not "these are similar".
 */
const DUPLICATE_DISTANCE = 3
const MIN_WORDS_TO_COMPARE = 100

export const TECH_012: Rule = {
  id: 'TECH-012',
  axis: 'content',
  severity: 'medium',
  estimatedEffort: 'medium',
  fixable: false,
  description: 'Several pages carry substantially the same content.',

  evaluate: (context) => {
    /**
     * Short pages are excluded. A pair of thin pages ("Contact us", "About us") will often
     * land within a few bits of each other simply because there is not enough text to tell
     * them apart, and reporting that as duplicate content is a false positive with a
     * confident face on it.
     */
    const candidates = indexableHtmlPages(context.pages)
      .filter((page) => page.extract.wordCount >= MIN_WORDS_TO_COMPARE)
      .map((page) => ({ page, hash: simhash(page.extract.text) }))

    const clustered = new Set<string>()
    const drafts = []

    for (let i = 0; i < candidates.length; i += 1) {
      const a = candidates[i]
      if (!a || clustered.has(a.page.finalUrl)) continue

      const cluster = [a.page.finalUrl]

      for (let j = i + 1; j < candidates.length; j += 1) {
        const b = candidates[j]
        if (!b || clustered.has(b.page.finalUrl)) continue

        if (hammingDistance(a.hash, b.hash) <= DUPLICATE_DISTANCE) {
          cluster.push(b.page.finalUrl)
          clustered.add(b.page.finalUrl)
        }
      }

      if (cluster.length > 1) {
        clustered.add(a.page.finalUrl)

        drafts.push({
          title: `${cluster.length} pages carry substantially the same content`,
          evidence: metricEvidence(
            a.page,
            'simhash_cluster_size',
            cluster.length,
            'count' as const,
          ),
          affectedUrls: cluster,
          confidence: 0.8,
          estimatedImpact: 45,
          falsification:
            'Read any two of these pages side by side. If a reader would call them different ' +
            'articles, this was wrong and the SimHash threshold is too loose. After the fix, ' +
            'either the pages carry distinct content, or the duplicates canonicalise to one ' +
            'URL and re-crawling finds a single indexable version.',
        })
      }
    }

    return drafts
  },
}
