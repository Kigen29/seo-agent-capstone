import {
  asOwner,
  competitorChanges,
  competitorSnapshots,
  sites,
  withTenant,
  type Database,
} from '@seo/db'
import { and, desc, eq, inArray, lt, max, notInArray, sql } from 'drizzle-orm'
import { gunzipSync, gzipSync } from 'node:zlib'
import { diffSnapshots } from './diff.js'
import { takeSnapshot, type CompetitorSnapshot, type SnapshotOptions } from './snapshot.js'

/**
 * The weekly sweep: snapshot each tracked competitor that is due, and record what changed.
 *
 * A sweep rather than a queue. The worker is a throttled cron (declared every 15 minutes, median
 * closer to three hours), and "is anything more than a week old?" is a question that survives any
 * schedule: a run that comes late does the work late, and a run that comes twice finds nothing
 * due. Nothing has to be enqueued for a particular day and nothing is lost if that day is skipped.
 */

/** A competitor is read again once its last snapshot is this old. */
export const WATCH_INTERVAL_DAYS = 7

/** Changes older than this are deleted. Snapshots are bounded separately, to two per competitor. */
export const CHANGE_RETENTION_DAYS = 180

/** Snapshots kept per competitor: the newest, and the one before it to diff the next against. */
const SNAPSHOTS_KEPT = 2

const DAY = 86_400_000

export interface WatchOptions {
  now?: Date
  /**
   * How many competitors one run reads. Each is up to a dozen sequential requests, and the run
   * shares an hour with every other queue, so the rest wait for the next run.
   */
  limit?: number
  /** Restrict the sweep to one site: a manual run, or a test sharing a database with others. */
  siteId?: string
  /** Injected for tests, in place of the network. */
  snapshot?: (competitor: string, options: SnapshotOptions) => Promise<CompetitorSnapshot>
}

export interface WatchResult {
  snapshots: number
  changes: number
}

const pack = (snapshot: CompetitorSnapshot): Buffer => gzipSync(JSON.stringify(snapshot))
const unpack = (body: Buffer): CompetitorSnapshot =>
  JSON.parse(gunzipSync(body).toString('utf8')) as CompetitorSnapshot

export async function watchCompetitors(
  db: Database,
  options: WatchOptions = {},
): Promise<WatchResult> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 6
  const snapshot = options.snapshot ?? takeSnapshot
  const dueBefore = new Date(now.getTime() - WATCH_INTERVAL_DAYS * DAY)

  // Across tenants, because the sweep has no tenant: it is the scheduler deciding whose turn it is.
  const { tracked, latest } = await asOwner(db, async (tx) => ({
    tracked: await tx
      .select({ id: sites.id, tenantId: sites.tenantId, competitors: sites.competitors })
      .from(sites)
      .where(
        and(
          sql`cardinality(${sites.competitors}) > 0`,
          options.siteId ? eq(sites.id, options.siteId) : undefined,
        ),
      ),
    latest: await tx
      .select({
        siteId: competitorSnapshots.siteId,
        competitor: competitorSnapshots.competitor,
        takenAt: max(competitorSnapshots.takenAt),
      })
      .from(competitorSnapshots)
      .groupBy(competitorSnapshots.siteId, competitorSnapshots.competitor),
  }))

  const lastTaken = new Map(latest.map((row) => [`${row.siteId}|${row.competitor}`, row.takenAt]))

  const due = tracked
    .flatMap((site) =>
      site.competitors.map((competitor) => ({
        siteId: site.id,
        tenantId: site.tenantId,
        competitor,
        tracked: site.competitors,
        last: lastTaken.get(`${site.id}|${competitor}`) ?? null,
      })),
    )
    .filter((entry) => entry.last === null || entry.last < dueBefore)
    // Never-read first, then longest-waiting, so a full run cannot starve anybody.
    .sort((a, b) => (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0))
    .slice(0, limit)

  const result: WatchResult = { snapshots: 0, changes: 0 }

  for (const entry of due) {
    // The network call is outside the transaction: a slow competitor must not hold a connection.
    const current = await snapshot(entry.competitor, {})

    const changed = await withTenant(db, entry.tenantId, async (tx) => {
      const [previous] = await tx
        .select({ body: competitorSnapshots.body })
        .from(competitorSnapshots)
        .where(
          and(
            eq(competitorSnapshots.siteId, entry.siteId),
            eq(competitorSnapshots.competitor, entry.competitor),
          ),
        )
        .orderBy(desc(competitorSnapshots.takenAt))
        .limit(1)

      const changes = previous ? diffSnapshots(unpack(previous.body), current) : []
      const body = pack(current)

      await tx.insert(competitorSnapshots).values({
        tenantId: entry.tenantId,
        siteId: entry.siteId,
        competitor: entry.competitor,
        takenAt: now,
        pagesRead: current.pages.length,
        note: current.note,
        body,
        bytes: body.length,
      })

      if (changes.length > 0) {
        await tx.insert(competitorChanges).values(
          changes.map((change) => ({
            tenantId: entry.tenantId,
            siteId: entry.siteId,
            competitor: entry.competitor,
            detectedAt: now,
            ...change,
          })),
        )
      }

      // The storage bound, applied on every write so it cannot fall behind.
      const kept = await tx
        .select({ id: competitorSnapshots.id })
        .from(competitorSnapshots)
        .where(
          and(
            eq(competitorSnapshots.siteId, entry.siteId),
            eq(competitorSnapshots.competitor, entry.competitor),
          ),
        )
        .orderBy(desc(competitorSnapshots.takenAt))
        .limit(SNAPSHOTS_KEPT)
      await tx.delete(competitorSnapshots).where(
        and(
          eq(competitorSnapshots.siteId, entry.siteId),
          eq(competitorSnapshots.competitor, entry.competitor),
          notInArray(
            competitorSnapshots.id,
            kept.map((row) => row.id),
          ),
        ),
      )
      // A competitor removed from the site's list leaves nothing behind.
      await tx
        .delete(competitorSnapshots)
        .where(
          and(
            eq(competitorSnapshots.siteId, entry.siteId),
            notInArray(competitorSnapshots.competitor, entry.tracked),
          ),
        )
      await tx
        .delete(competitorChanges)
        .where(
          and(
            eq(competitorChanges.siteId, entry.siteId),
            lt(competitorChanges.detectedAt, new Date(now.getTime() - CHANGE_RETENTION_DAYS * DAY)),
          ),
        )

      return changes.length
    })

    result.snapshots += 1
    result.changes += changed
  }

  return result
}

/** The competitors of a site that still have a snapshot on record. Used by the report. */
export async function latestSnapshots(
  tx: Database,
  siteId: string,
  competitors: readonly string[],
): Promise<Map<string, { takenAt: Date; pagesRead: number; note: string | null }>> {
  if (competitors.length === 0) return new Map()

  const rows = await tx
    .select({
      competitor: competitorSnapshots.competitor,
      takenAt: competitorSnapshots.takenAt,
      pagesRead: competitorSnapshots.pagesRead,
      note: competitorSnapshots.note,
    })
    .from(competitorSnapshots)
    .where(
      and(
        eq(competitorSnapshots.siteId, siteId),
        inArray(competitorSnapshots.competitor, [...competitors]),
      ),
    )
    .orderBy(desc(competitorSnapshots.takenAt))

  const newest = new Map<string, { takenAt: Date; pagesRead: number; note: string | null }>()
  for (const row of rows) {
    if (!newest.has(row.competitor)) newest.set(row.competitor, row)
  }
  return newest
}
