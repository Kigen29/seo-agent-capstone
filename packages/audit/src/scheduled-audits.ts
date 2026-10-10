import { AUDIT_CADENCE_DAYS, nextAuditDay, utcDayOf, type AuditCadence } from '@seo/core'
import { appendJob, asOwner, audits, sites, withTenant, type Database } from '@seo/db'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'

/**
 * Start an audit for every site whose scheduled one is due (ADR-0044).
 *
 * A sweep, in the same shape as the daily poll and the weekly competitor watch: the worker wakes,
 * asks who is due, and acts. There is no cron entry per site and no stored "next run", so there
 * is nothing to drift: a worker that was down for a day finds the same sites due when it comes
 * back and does the work late.
 *
 * "Due" is decided by `nextAuditDay`, the function the calendar page uses, so the day a person
 * was shown is the day this acts on.
 *
 * Three things keep it from running away:
 *
 *   - a site with an audit already queued or running is skipped, so a slow crawl is never joined
 *     by a second one;
 *   - the site's row is locked and the check for an audit in flight is made again inside the
 *     transaction that writes the new one, so two workers waking together start one audit
 *     between them, and the audit row and its outbox entry land together or not at all;
 *   - a run starts at most `limit` audits. The rest are still due on the next wake, fifteen
 *     minutes later, which spreads a Monday's worth of weekly audits across the runner's time
 *     instead of handing one runner forty crawls.
 *
 * The audit is created exactly as `POST /audits` creates one, as a `queued` row with an `audit`
 * job in the outbox, so everything downstream (progress, failure, the abandoned-audit sweep)
 * treats it as it would one a person started.
 */
export interface ScheduledAuditOptions {
  now?: Date
  /** The most audits one run may start. */
  limit?: number
  /** Restrict the sweep to one site, for a test sharing a database with others. */
  siteId?: string
}

export const SCHEDULED_AUDITS_PER_RUN = 5

export async function enqueueDueAudits(
  db: Database,
  options: ScheduledAuditOptions = {},
): Promise<number> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? SCHEDULED_AUDITS_PER_RUN
  const today = utcDayOf(now)

  // Across tenants: this is the scheduler deciding whose turn it is, not a request.
  const candidates = await asOwner(db, (tx) =>
    tx
      // The table is named in full inside the subqueries. Drizzle writes a bare `"id"` for a column
      // in a query over one table, and inside `from audits a` a bare id is the audit's own.
      .select({
        id: sites.id,
        tenantId: sites.tenantId,
        url: sites.url,
        cadence: sites.auditCadence,
        lastAuditAt: sql<Date | null>`(
          select max(a.started_at) from audits a where a.site_id = "sites"."id"
        )`.mapWith((value: string | null) => (value ? new Date(value) : null)),
        inFlight: sql<boolean>`exists (
          select 1 from audits a
           where a.site_id = "sites"."id" and a.status in ('queued', 'crawling', 'evaluating')
        )`,
      })
      .from(sites)
      .where(
        and(
          ne(sites.auditCadence, 'off'),
          inArray(sites.auditCadence, Object.keys(AUDIT_CADENCE_DAYS)),
          options.siteId ? eq(sites.id, options.siteId) : undefined,
        ),
      ),
  )

  const due = candidates
    .filter(
      (site) =>
        !site.inFlight &&
        nextAuditDay(site.cadence as AuditCadence, site.lastAuditAt, now) === today,
    )
    // Never audited first, then longest waiting, so a full run cannot starve anybody.
    .sort((a, b) => (a.lastAuditAt?.getTime() ?? 0) - (b.lastAuditAt?.getTime() ?? 0))
    .slice(0, limit)

  let started = 0
  for (const site of due) {
    // Back through the tenant's own context for the write, like every other write here.
    const created = await withTenant(db, site.tenantId, async (tx) => {
      // The lock is what makes the check below true for as long as it takes to act on it.
      await tx.execute(sql`select 1 from sites where id = ${site.id} for update`)
      const [busy] = await tx
        .select({ id: audits.id })
        .from(audits)
        .where(
          and(
            eq(audits.siteId, site.id),
            inArray(audits.status, ['queued', 'crawling', 'evaluating']),
          ),
        )
        .limit(1)
      if (busy) return false

      const [audit] = await tx
        .insert(audits)
        .values({ tenantId: site.tenantId, siteId: site.id, status: 'queued' })
        .returning({ id: audits.id })
      await appendJob(tx, site.tenantId, `audit:${audit!.id}`, 'audit', {
        auditId: audit!.id,
        tenantId: site.tenantId,
        siteId: site.id,
        seed: site.url,
      })
      return true
    })
    if (created) started += 1
  }
  return started
}
