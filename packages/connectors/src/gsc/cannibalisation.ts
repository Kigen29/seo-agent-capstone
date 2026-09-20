import { parseFinding, type Finding } from '@seo/core'
import type { SearchAnalyticsRow } from './types.js'

/**
 * Find queries where the site competes with itself, deterministically.
 *
 * Keyword cannibalisation is the one content problem every crawler claims to detect and none
 * can: from markup alone, two pages about tiles are just two pages about tiles. Whether they
 * actually compete is a fact about what Google does with them, and only Search Console knows
 * it. Grouped by query and page, a cannibalised query looks unmistakable: one query, two or
 * more of the client's own URLs, impressions divided between them, and neither holding a
 * position that either page would hold alone.
 *
 * That is the whole detector. No model is asked whether two pages are "too similar", because
 * similarity is not the question; the question is whether Google is switching between them,
 * and the field data answers it outright.
 *
 * What the finding does not do is say which page should win. That is a content decision with
 * commercial consequences (one of them may be the page that converts), so this raises the
 * conflict with the numbers attached and leaves the choice to a human. It is not fixable by a
 * generated diff, and it says so.
 */

export interface CannibalisationInput {
  siteId: string
  siteUrl: string
  startDate: string
  endDate: string
  /** Rows grouped by the `query` and `page` dimensions, in that order: keys is [query, page]. */
  rows: SearchAnalyticsRow[]
}

/** Below this, a query is noise: a handful of impressions is not a conflict worth acting on. */
const MIN_IMPRESSIONS = 50

/**
 * How much of a query's impressions a page needs before it counts as a contender.
 *
 * Without a floor, every long-tail query has a "conflict": Google shows an odd page once, and
 * a single impression out of two thousand would read as two pages competing. A fifth of the
 * query is a page Google is genuinely choosing, not one it tried once.
 */
const MIN_SHARE = 0.2

/**
 * A query whose best page already ranks this high is left alone.
 *
 * Cannibalisation costs you the difference between two mediocre positions and one good one. If
 * the site already holds a top-three spot for the query, that cost is mostly paid, and telling
 * a client to restructure pages that are winning is how an audit loses its credibility.
 */
const ALREADY_WINNING = 3

/** The share one page must hold after a consolidation for it to have worked. */
const CONSOLIDATED_SHARE = 0.8

const clampImpact = (raw: number): number => Math.max(1, Math.min(90, Math.round(raw)))

interface Contender {
  url: string
  impressions: number
  clicks: number
  position: number
}

export function evaluateCannibalisation(input: CannibalisationInput): Finding[] {
  const byQuery = new Map<string, { query: string; pages: Contender[] }>()

  for (const row of input.rows) {
    const [query, url] = row.keys
    // A row from a query-only request has no page, and a row with no query cannot be grouped.
    // Either way this evaluator has nothing to say about it, so it is skipped rather than
    // guessed at.
    if (!query || !url) continue

    const key = query.toLowerCase().trim()
    const entry = byQuery.get(key) ?? { query, pages: [] }
    entry.pages.push({
      url,
      impressions: row.impressions,
      clicks: row.clicks,
      position: row.position,
    })
    byQuery.set(key, entry)
  }

  const findings: Finding[] = []
  const observedAt = new Date().toISOString()

  for (const [key, entry] of byQuery) {
    if (entry.pages.length < 2) continue

    const impressions = entry.pages.reduce((sum, page) => sum + page.impressions, 0)
    if (impressions < MIN_IMPRESSIONS) continue

    const contenders = entry.pages
      .filter((page) => page.impressions / impressions >= MIN_SHARE)
      .sort((a, b) => b.impressions - a.impressions)

    if (contenders.length < 2) continue

    // The best position any of the competing pages managed. This is what a consolidated page
    // would have to beat, and it is also the test for whether the conflict is costing anything.
    const bestPosition = Math.min(...contenders.map((page) => page.position))
    if (bestPosition <= ALREADY_WINNING) continue

    const clicks = contenders.reduce((sum, page) => sum + page.clicks, 0)
    const contenderImpressions = contenders.reduce((sum, page) => sum + page.impressions, 0)
    const share = (page: Contender) => Math.round((page.impressions / impressions) * 100)

    findings.push(
      parseFinding({
        id: `CONTENT-001#${key}`,
        siteId: input.siteId,
        ruleId: 'CONTENT-001',
        axis: 'content',
        severity: 'medium',
        confidence: 1,
        title:
          `${contenders.length} pages compete for "${entry.query}": ` +
          contenders.map((page) => `${page.url} (${share(page)}%)`).join(', ') +
          `, best average position ${bestPosition.toFixed(1)}`,
        evidence: {
          kind: 'search',
          source: 'gsc',
          observedAt,
          query: entry.query,
          position: bestPosition,
          impressions: contenderImpressions,
          clicks,
          ctr: contenderImpressions === 0 ? 0 : clicks / contenderImpressions,
          startDate: input.startDate,
          endDate: input.endDate,
          competingUrls: contenders,
        },
        affectedUrls: contenders.map((page) => page.url),
        // Choosing a winner, merging the other page's substance into it and redirecting is a
        // day's work on a small site and never a one-line change.
        estimatedEffort: 'medium',
        estimatedImpact: clampImpact(impressions / 25),
        falsification:
          `Re-query Search Console for "${entry.query}" grouped by page, 28 days after ` +
          `consolidating. The fix failed if the impressions are still split, meaning no single ` +
          `URL holds at least ${CONSOLIDATED_SHARE * 100}% of them, or if the surviving page's ` +
          `average position is no better than ${bestPosition.toFixed(1)}. Search Console lags ` +
          `two to three days, so an immediate re-check proves nothing.`,
        fixable: false,
        status: 'open',
      }),
    )
  }

  return findings
}

/** How many distinct checks this represents, for the scorecard coverage count. */
export const CANNIBALISATION_CHECKS = 1
