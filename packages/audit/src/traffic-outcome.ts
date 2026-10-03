import type { MetricSnapshot, VerificationResult } from '@seo/core'
import { normaliseUrl } from '@seo/crawler'

/**
 * Search traffic to a fixed finding's pages, before the fix and after it.
 *
 * The rule-level outcome (the problem is gone, or it is not) is known within days of a deploy.
 * Whether that moved anything a business cares about is slower: Search Console reports clicks with
 * a two to three day lag, and a fair comparison needs equal windows either side. So this runs once
 * the after-window has closed, and measures both windows from Search Console's history at the same
 * time: the 28 days before the pull request opened, and the 28 days after the fix was verified.
 *
 * It says what moved, never why. A rise after a fix is correlation, and seasonality, a Google
 * update or a campaign can do the same; the page says so next to the numbers.
 */

const DAY_MS = 24 * 60 * 60 * 1000
export const TRAFFIC_WINDOW_DAYS = 28
/** Search Console's reporting delay, so the after-window is complete before it is read. */
export const SEARCH_CONSOLE_LAG_DAYS = 3

export const CLICKS_METRIC = 'Search clicks, 28 days'
export const IMPRESSIONS_METRIC = 'Search impressions, 28 days'

export interface DateWindow {
  startDate: string
  endDate: string
}

const iso = (date: Date) => date.toISOString().slice(0, 10)
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)

/** The two equal windows: ending the day before the PR opened, and starting the day it verified. */
export function trafficWindows(
  openedAt: Date,
  verifiedAt: Date,
): { before: DateWindow; after: DateWindow } {
  return {
    before: {
      startDate: iso(plusDays(openedAt, -TRAFFIC_WINDOW_DAYS)),
      endDate: iso(plusDays(openedAt, -1)),
    },
    after: {
      startDate: iso(verifiedAt),
      endDate: iso(plusDays(verifiedAt, TRAFFIC_WINDOW_DAYS - 1)),
    },
  }
}

/** When the after-window is complete in Search Console, and the comparison can be made. */
export function trafficReadyAt(verifiedAt: Date): Date {
  return plusDays(verifiedAt, TRAFFIC_WINDOW_DAYS + SEARCH_CONSOLE_LAG_DAYS)
}

/** Whether a verification record already carries the traffic comparison. */
export function hasTraffic(verification: VerificationResult): boolean {
  return verification.after.metrics.some((metric) => metric.metric === CLICKS_METRIC)
}

/** Match key for a page: normalised, and blind to a leading www, as Search Console may report either. */
function pageKey(url: string): string {
  const normalised = normaliseUrl(url) ?? url
  try {
    const parsed = new URL(normalised)
    parsed.hostname = parsed.hostname.replace(/^www\./, '')
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return normalised
  }
}

export interface PageTraffic {
  clicks: number
  impressions: number
}

/** The minimum of the GSC client this needs, so a test can hand in a fake. */
export interface SearchAnalyticsSource {
  searchAnalytics(
    property: string,
    query: {
      startDate: string
      endDate: string
      dimensions: string[]
      rowLimit?: number
      startRow?: number
    },
  ): Promise<{ keys?: string[]; clicks: number; impressions: number }[]>
}

/** Total clicks and impressions for the given pages in one window, from page-level rows. */
export async function measurePageTraffic(
  gsc: SearchAnalyticsSource,
  property: string,
  pages: readonly string[],
  window: DateWindow,
): Promise<PageTraffic> {
  const wanted = new Set(pages.map(pageKey))
  let clicks = 0
  let impressions = 0
  // Refuse partial measurements instead of inventing zeros after a truncated response.
  for (let startRow = 0; startRow < 250_000; startRow += 25_000) {
    const rows = await gsc.searchAnalytics(property, {
      ...window,
      dimensions: ['page'],
      rowLimit: 25_000,
      startRow,
    })
    for (const row of rows) {
      const page = row.keys?.[0]
      if (!page || !wanted.has(pageKey(page))) continue
      clicks += row.clicks
      impressions += row.impressions
    }
    if (rows.length < 25_000) return { clicks, impressions }
  }
  throw new Error(
    'Search Console page results exceeded the measurement limit; comparison remains unmeasured.',
  )
}

function withTraffic(snapshot: MetricSnapshot, traffic: PageTraffic, at: string): MetricSnapshot {
  const kept = snapshot.metrics.filter(
    (metric) => metric.metric !== CLICKS_METRIC && metric.metric !== IMPRESSIONS_METRIC,
  )
  return {
    ...snapshot,
    metrics: [
      ...kept,
      {
        kind: 'metric',
        source: 'gsc',
        observedAt: at,
        metric: CLICKS_METRIC,
        value: traffic.clicks,
        unit: 'count',
      },
      {
        kind: 'metric',
        source: 'gsc',
        observedAt: at,
        metric: IMPRESSIONS_METRIC,
        value: traffic.impressions,
        unit: 'count',
      },
    ],
  }
}

/** The verification record with both windows' traffic added to its before and after snapshots. */
export function addTraffic(
  verification: VerificationResult,
  before: PageTraffic,
  after: PageTraffic,
  now: Date = new Date(),
): VerificationResult {
  const at = now.toISOString()
  return {
    ...verification,
    before: withTraffic(verification.before, before, at),
    after: withTraffic(verification.after, after, at),
  }
}
