import { parseFinding, type Finding } from '@seo/core'
import type { SearchAnalyticsRow } from './types.js'

/**
 * Turn real Search Console performance into quick wins, deterministically.
 *
 * A quick win is a page that is already earning impressions but leaving clicks on the table,
 * so a small change yields a large gain. That is the opposite of most findings, which are
 * problems: these are opportunities, and they are only visible because the field data shows
 * the page already ranks. No crawl can find them, and no language model should guess them;
 * they come straight from what Google is already showing real users.
 *
 * Two distinct shapes, kept apart because the fix for each is different:
 *
 *   1. Page-2 rankings (position 11 to 20). The page ranks, but on page two, where almost
 *      nobody clicks. Reaching page one is a step change in traffic. The fix is usually
 *      content depth or internal links, so the effort is real.
 *
 *   2. Page-1 rankings with a poor click-through rate for their position. The page ranks
 *      where people can see it, but the title and description are not earning the click a
 *      position like that should. The fix is a title and meta rewrite: cheap, and often the
 *      single highest-return change on the site.
 *
 * Both carry the caveat every field-data finding carries: Search Console lags two to three
 * days, and a fix will not show for weeks, so an immediate re-check proves nothing.
 */

export interface QuickWinsInput {
  siteId: string
  siteUrl: string
  startDate: string
  endDate: string
  /** Rows grouped by the `query` dimension: keys is [query]. */
  rows: SearchAnalyticsRow[]
}

/** Below this, a row is noise: a handful of impressions is not a trend worth acting on. */
const MIN_IMPRESSIONS = 50

/** Page two, roughly. Ranking here means the page is close but getting no traffic. */
const PAGE_TWO = { min: 10.5, max: 20.5 }

/**
 * Roughly what a position earns in click-through rate, from public aggregate studies. These
 * are not promises, they are a yardstick: a page ranking third that gets a third of the
 * third-place rate is visibly underperforming its own ranking, and that gap is the finding.
 */
const EXPECTED_CTR: Record<number, number> = {
  1: 0.28,
  2: 0.15,
  3: 0.1,
  4: 0.07,
  5: 0.05,
  6: 0.04,
  7: 0.03,
  8: 0.025,
  9: 0.02,
  10: 0.018,
}

/** A page-1 CTR below half of what the position typically earns is the opportunity. */
const CTR_SHORTFALL = 0.5

const clampImpact = (raw: number): number => Math.max(1, Math.min(90, Math.round(raw)))

export function evaluateQuickWins(input: QuickWinsInput): Finding[] {
  const findings: Finding[] = []
  const window = { startDate: input.startDate, endDate: input.endDate }
  const observedAt = new Date().toISOString()

  for (const row of input.rows) {
    const query = row.keys[0]
    if (!query || row.impressions < MIN_IMPRESSIONS) continue

    const evidence = {
      kind: 'search' as const,
      source: 'gsc' as const,
      observedAt,
      query,
      position: row.position,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      ...window,
    }

    // Page-2 opportunity: ranking, but where nobody clicks.
    if (row.position >= PAGE_TWO.min && row.position <= PAGE_TWO.max) {
      findings.push(
        parseFinding({
          id: `QW-STRIKING#${findings.length}`,
          siteId: input.siteId,
          ruleId: 'QW-STRIKING',
          axis: 'content',
          severity: 'medium',
          confidence: 1,
          title:
            `On page two for "${query}" (position ${row.position.toFixed(1)}), ` +
            `with ${row.impressions.toLocaleString()} impressions going almost unclicked`,
          evidence,
          affectedUrls: [input.siteUrl],
          estimatedEffort: 'medium',
          // The prize is the impressions currently stuck on page two. Scaled so a couple of
          // thousand impressions reads as a major opportunity.
          estimatedImpact: clampImpact(row.impressions / 25),
          falsification:
            `Re-query Search Console for "${query}" 28 days after the change. If the average ` +
            `position has not moved toward page one, the change did not help. Search Console ` +
            `lags two to three days, so an immediate re-check showing no movement is expected.`,
          fixable: false,
          status: 'open',
        }),
      )
      continue
    }

    // Page-1 underperformer: ranks where people can see it, but is not earning the click.
    const expected = EXPECTED_CTR[Math.round(row.position)]
    if (expected !== undefined && row.ctr < expected * CTR_SHORTFALL) {
      const missedClicks = Math.round(row.impressions * (expected - row.ctr))
      if (missedClicks < 5) continue

      findings.push(
        parseFinding({
          id: `QW-CTR#${findings.length}`,
          siteId: input.siteId,
          ruleId: 'QW-CTR',
          axis: 'content',
          severity: 'medium',
          confidence: 1,
          title:
            `Ranks position ${row.position.toFixed(1)} for "${query}" but earns only ` +
            `${(row.ctr * 100).toFixed(1)}% of clicks, against about ` +
            `${(expected * 100).toFixed(0)}% typical for that spot`,
          evidence,
          affectedUrls: [input.siteUrl],
          // Cheap: a title and meta rewrite, no ranking work.
          estimatedEffort: 'small',
          estimatedImpact: clampImpact(missedClicks / 5),
          falsification:
            `Re-query Search Console for "${query}" 28 days after rewriting the title and ` +
            `meta description. If the click-through rate has not risen while the position held, ` +
            `the rewrite did not help. Note the two-to-three-day reporting lag.`,
          fixable: false,
          status: 'open',
        }),
      )
    }
  }

  return findings
}

/** How many distinct checks quick-wins represents, for the scorecard coverage count. */
export const QUICK_WIN_CHECKS = 2
