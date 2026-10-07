import { competitorChanges, sites, visibilityChecks, withTenant, type Database } from '@seo/db'
import { and, desc, eq, gte } from 'drizzle-orm'
import type { ChangeKind } from './diff.js'
import { latestSnapshots, WATCH_INTERVAL_DAYS } from './watch.js'

/**
 * What a site's competitors changed, with what their AI citations did either side of it.
 *
 * The second half is the reason this exists. A list of changed titles is what every watcher
 * sells. We also poll the answer engines daily and record which competitors each answer cited, so
 * a change can be shown next to the week before it and the week after.
 *
 * And that is all it is shown next to. Two things happening in order is not one causing the
 * other: engines' answers move from day to day on their own, and a competitor who rewrote a page
 * probably changed five other things that week. The numbers are reported as counts either side
 * of a date, the sample is always shown, and nothing here computes a "lift".
 */

/** Citations are compared over the same span either side of a change. */
export const CITATION_WINDOW_DAYS = 7

/** How far back the report looks. Older changes exist until retention removes them. */
const REPORT_DAYS = 90

const DAY = 86_400_000

/** A competitor's citations over a span: how many checks named them, out of how many ran. */
export interface CitationWindow {
  cited: number
  checks: number
}

export interface WatchedChange {
  kind: ChangeKind
  url: string
  before: string | null
  after: string | null
}

/** Everything one snapshot found changed for one competitor, with the citations around it. */
export interface ChangeBatch {
  competitor: string
  detectedAt: string
  changes: WatchedChange[]
  citationsBefore: CitationWindow
  citationsAfter: CitationWindow
  /** False until a full window has passed since the change, so a partial week is labelled. */
  afterComplete: boolean
}

export interface WatchedCompetitor {
  domain: string
  /** Null when the weekly sweep has not reached this competitor yet. */
  lastSnapshotAt: string | null
  pagesRead: number
  /** Why the last snapshot read nothing, when it did not. */
  note: string | null
}

export interface CompetitorWatchReport {
  competitors: WatchedCompetitor[]
  batches: ChangeBatch[]
  intervalDays: number
  windowDays: number
}

const dayOf = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * A competitor's citations in the days before a date and from it onward. Pure.
 *
 * Days are compared as `YYYY-MM-DD` strings, which is what `polled_on` stores and sorts correctly.
 * "Before" ends the day before the change was detected; "after" starts on that day.
 */
export function citationWindows(
  checks: readonly { polledOn: string; citedCompetitors: readonly string[] }[],
  competitor: string,
  detectedAt: Date,
  windowDays: number = CITATION_WINDOW_DAYS,
): { before: CitationWindow; after: CitationWindow } {
  const start = dayOf(new Date(detectedAt.getTime() - windowDays * DAY))
  const on = dayOf(detectedAt)
  const end = dayOf(new Date(detectedAt.getTime() + windowDays * DAY))

  const before: CitationWindow = { cited: 0, checks: 0 }
  const after: CitationWindow = { cited: 0, checks: 0 }

  for (const check of checks) {
    const window =
      check.polledOn >= start && check.polledOn < on
        ? before
        : check.polledOn >= on && check.polledOn < end
          ? after
          : null
    if (!window) continue
    window.checks += 1
    if (check.citedCompetitors.includes(competitor)) window.cited += 1
  }

  return { before, after }
}

/** Null when the site is not the tenant's, so the route can answer 404 rather than an empty page. */
export async function competitorWatchReport(
  db: Database,
  tenantId: string,
  siteId: string,
  now: Date = new Date(),
): Promise<CompetitorWatchReport | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({ competitors: sites.competitors })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) return null

    const since = new Date(now.getTime() - REPORT_DAYS * DAY)
    const snapshots = await latestSnapshots(tx, siteId, site.competitors)

    const rows = await tx
      .select({
        competitor: competitorChanges.competitor,
        detectedAt: competitorChanges.detectedAt,
        kind: competitorChanges.kind,
        url: competitorChanges.url,
        before: competitorChanges.before,
        after: competitorChanges.after,
      })
      .from(competitorChanges)
      .where(and(eq(competitorChanges.siteId, siteId), gte(competitorChanges.detectedAt, since)))
      .orderBy(
        desc(competitorChanges.detectedAt),
        competitorChanges.competitor,
        competitorChanges.url,
      )

    const checks =
      rows.length === 0
        ? []
        : await tx
            .select({
              polledOn: visibilityChecks.polledOn,
              citedCompetitors: visibilityChecks.citedCompetitors,
            })
            .from(visibilityChecks)
            .where(
              and(
                eq(visibilityChecks.siteId, siteId),
                gte(
                  visibilityChecks.polledOn,
                  dayOf(new Date(since.getTime() - CITATION_WINDOW_DAYS * DAY)),
                ),
              ),
            )

    // One batch per competitor per snapshot: the rows of one sweep share a `detectedAt` exactly.
    const batches = new Map<string, ChangeBatch>()
    for (const row of rows) {
      const key = `${row.competitor}|${row.detectedAt.toISOString()}`
      let batch = batches.get(key)
      if (!batch) {
        const windows = citationWindows(checks, row.competitor, row.detectedAt)
        batch = {
          competitor: row.competitor,
          detectedAt: row.detectedAt.toISOString(),
          changes: [],
          citationsBefore: windows.before,
          citationsAfter: windows.after,
          afterComplete: now.getTime() >= row.detectedAt.getTime() + CITATION_WINDOW_DAYS * DAY,
        }
        batches.set(key, batch)
      }
      batch.changes.push({ kind: row.kind, url: row.url, before: row.before, after: row.after })
    }

    return {
      competitors: site.competitors.map((domain) => {
        const snapshot = snapshots.get(domain)
        return {
          domain,
          lastSnapshotAt: snapshot?.takenAt.toISOString() ?? null,
          pagesRead: snapshot?.pagesRead ?? 0,
          note: snapshot?.note ?? null,
        }
      }),
      batches: [...batches.values()],
      intervalDays: WATCH_INTERVAL_DAYS,
      windowDays: CITATION_WINDOW_DAYS,
    }
  })
}
