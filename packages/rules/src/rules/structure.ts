import { normaliseUrl, type CrawledPage } from '@seo/crawler'
import { graphEvidence } from '../evidence.js'
import type { Rule, RuleContext } from '../types.js'

const pageFor = (context: RuleContext, url: string): CrawledPage | undefined =>
  context.pages.find((page) => (normaliseUrl(page.finalUrl) ?? page.finalUrl) === url)

/**
 * TECH-013: an orphan page. Nothing on the site links to it.
 *
 * A page with no internal inbound links cannot be reached by a crawler walking the site,
 * and it receives no internal link equity. If it is in the sitemap, Google may find it
 * and index it anyway, but it will be treated as unimportant, because the site's own
 * linking says it is unimportant.
 */
export const TECH_013: Rule = {
  id: 'TECH-013',
  axis: 'structure',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: true,
  description: 'A page has no internal links pointing at it.',

  evaluate: (context) =>
    context.graph.orphans.flatMap((url) => {
      const node = context.graph.nodes.get(url)
      const page = pageFor(context, url)
      if (!node || !page) return []

      return [
        {
          title: `${url} is an orphan: nothing on the site links to it`,
          evidence: graphEvidence(page, node),
          affectedUrls: [url],
          confidence: 1,
          estimatedImpact: 50,
          falsification:
            `Re-crawl and count internal followed links pointing at ${url}. If the count is ` +
            'above zero, this was wrong. After the fix, the page should have at least one ' +
            'internal inbound link and a finite click depth from the homepage.',
        },
      ]
    }),
}

/**
 * TECH-014: a page buried more than three clicks from the homepage.
 *
 * Depth is a proxy for how important the site itself treats a page. Three clicks is the
 * conventional line, and it is a rule of thumb rather than a law, which the falsification
 * condition says out loud rather than pretending otherwise.
 */
export const TECH_014: Rule = {
  id: 'TECH-014',
  axis: 'structure',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: true,
  description: 'A page is more than three clicks from the homepage.',

  evaluate: (context) =>
    context.graph.nearOrphans.flatMap((url) => {
      const node = context.graph.nodes.get(url)
      const page = pageFor(context, url)
      if (!node || !page) return []

      return [
        {
          title: `${url} is ${node.clickDepth} clicks from the homepage`,
          evidence: graphEvidence(page, node),
          affectedUrls: [url],
          confidence: 0.9,
          estimatedImpact: 30,
          falsification:
            `Re-crawl and compute the shortest path from the homepage to ${url}. If it is ` +
            'three clicks or fewer, this was wrong. Be honest about the limits of this one: ' +
            'click depth is a heuristic for importance, not a ranking factor. Reducing depth ' +
            'without also giving the page real internal links from relevant pages will not ' +
            'move anything.',
        },
      ]
    }),
}
