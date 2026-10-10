import {
  auditCadenceSchema,
  buildSchedule,
  monthWindow,
  dayStart,
  addDays,
  utcDayOf,
  type AuditCadence,
  type SiteSchedule,
} from '@seo/core'
import {
  audits,
  competitorSnapshots,
  findings,
  sites,
  visibilityChecks,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import { and, count, desc, eq, gte, inArray, isNotNull, lt, max, sql } from 'drizzle-orm'
import { hasTraffic, trafficReadyAt } from './traffic-outcome.js'

/**
 * A site's calendar for one month, read from what is stored (ADR-0044).
 *
 * The reading side of `buildSchedule`. It gathers the facts the worker's own sweeps act on, the
 * last audit, the tracked questions, each competitor's last reading, the fixes still waiting for
 * their traffic comparison, and hands them to the pure function that turns them into days. No
 * table of future jobs is read because there is none.
 *
 * One transaction, so the calendar is a single consistent view and every row passes row-level
 * security: another tenant's site is a 404, not an empty month.
 */

const RUNNING = ['queued', 'crawling', 'evaluating'] as const

/** Null when the site is not the tenant's. */
export async function readSchedule(
  db: Database,
  tenantId: string,
  siteId: string,
  month: string,
  now: Date = new Date(),
): Promise<SiteSchedule | null> {
  const window = monthWindow(month)
  const from = dayStart(window.from)
  const until = dayStart(addDays(window.to, 1))

  return withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({ competitors: sites.competitors, auditCadence: sites.auditCadence })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) return null

    const inWindow = await tx
      .select({
        id: audits.id,
        status: audits.status,
        startedAt: audits.startedAt,
        pagesCrawled: audits.pagesCrawled,
      })
      .from(audits)
      .where(
        and(eq(audits.siteId, siteId), gte(audits.startedAt, from), lt(audits.startedAt, until)),
      )
      .orderBy(desc(audits.startedAt))

    const [latest] = await tx
      .select({ startedAt: audits.startedAt, status: audits.status })
      .from(audits)
      .where(eq(audits.siteId, siteId))
      .orderBy(desc(audits.startedAt))
      .limit(1)

    const [running] = await tx
      .select({ id: audits.id })
      .from(audits)
      .where(and(eq(audits.siteId, siteId), inArray(audits.status, [...RUNNING])))
      .limit(1)

    const [prompts] = await tx
      .select({ total: count() })
      .from(visibilityPrompts)
      .where(eq(visibilityPrompts.siteId, siteId))

    const polled = await tx
      .select({ day: visibilityChecks.polledOn, checks: count() })
      .from(visibilityChecks)
      .where(
        and(
          eq(visibilityChecks.siteId, siteId),
          gte(visibilityChecks.polledOn, window.from),
          sql`${visibilityChecks.polledOn} <= ${window.to}`,
        ),
      )
      .groupBy(visibilityChecks.polledOn)

    const lastRead = await tx
      .select({
        competitor: competitorSnapshots.competitor,
        takenAt: max(competitorSnapshots.takenAt),
      })
      .from(competitorSnapshots)
      .where(eq(competitorSnapshots.siteId, siteId))
      .groupBy(competitorSnapshots.competitor)

    const readings = await tx
      .select({
        competitor: competitorSnapshots.competitor,
        takenAt: competitorSnapshots.takenAt,
        pagesRead: competitorSnapshots.pagesRead,
      })
      .from(competitorSnapshots)
      .where(
        and(
          eq(competitorSnapshots.siteId, siteId),
          gte(competitorSnapshots.takenAt, from),
          lt(competitorSnapshots.takenAt, until),
        ),
      )

    // The same selection the worker's traffic sweep makes, for this one site.
    const decided = await tx
      .select({ id: findings.id, title: findings.title, verification: findings.verification })
      .from(findings)
      .where(
        and(
          eq(findings.siteId, siteId),
          inArray(findings.status, ['verified', 'rejected']),
          isNotNull(findings.verification),
          isNotNull(findings.baseline),
        ),
      )

    const lastReadAt = new Map(lastRead.map((row) => [row.competitor, row.takenAt]))
    const auditCadence = auditCadenceSchema.catch('off').parse(site.auditCadence)

    return {
      month,
      from: window.from,
      to: window.to,
      today: utcDayOf(now),
      auditCadence,
      events: buildSchedule(
        {
          auditCadence,
          audits: inWindow,
          lastAuditAt: latest?.startedAt ?? null,
          lastAuditFailed: latest?.status === 'failed',
          auditInFlight: Boolean(running),
          promptCount: prompts?.total ?? 0,
          polledDays: polled.map((row) => ({ day: String(row.day), checks: row.checks })),
          competitors: site.competitors.map((domain) => ({
            domain,
            lastReadAt: lastReadAt.get(domain) ?? null,
          })),
          // A competitor that was dropped keeps its past readings on the calendar: they happened.
          readings,
          trafficPending: decided
            .filter((row) => row.verification !== null && !hasTraffic(row.verification))
            .map((row) => ({
              rowId: row.id,
              title: row.title,
              readyAt: trafficReadyAt(new Date(row.verification!.verifiedAt)),
            })),
        },
        { from: window.from, to: window.to, now },
      ),
    }
  })
}

/** Set how often a site is audited on its own. Null when the site is not the tenant's. */
export async function saveAuditCadence(
  db: Database,
  tenantId: string,
  siteId: string,
  cadence: AuditCadence,
): Promise<AuditCadence | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [saved] = await tx
      .update(sites)
      .set({ auditCadence: cadence })
      .where(eq(sites.id, siteId))
      .returning({ auditCadence: sites.auditCadence })
    return saved ? auditCadenceSchema.parse(saved.auditCadence) : null
  })
}
