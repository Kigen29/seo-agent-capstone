import {
  addTraffic,
  hasTraffic,
  measurePageTraffic,
  openSearchConsole,
  trafficReadyAt,
  trafficWindows,
} from '@seo/audit'
import { googleOAuthConfigFromEnv, type OAuthConfig } from '@seo/connectors'
import { asOwner, findings, sites, withTenant, type Database } from '@seo/db'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'

export interface TrafficSweepOptions {
  now?: Date
  /** Fixes measured per run, a guard on the Search Console quota. */
  limit?: number
  /** Injected for tests; production reads the Google OAuth config from the environment. */
  config?: OAuthConfig
  /** Injected for tests, so the token refresh and Search Console calls never leave the process. */
  fetch?: typeof globalThis.fetch
}

/**
 * Add the Search Console before-and-after to every checked fix whose after-window has closed.
 *
 * A fix is verified or rejected within days of its deploy; whether search traffic to its pages
 * moved takes 28 days plus Search Console's reporting lag to know. So this sweep, not the verify
 * job, does it: on each run it takes the decided fixes that are ready and not yet measured, opens
 * the tenant's Search Console once per site, and writes both windows into the verification record.
 *
 * Quietly skips what it cannot measure: no Google connection, no matching property, or a Search
 * Console error. Those fixes are simply tried again next run, and the page keeps saying the
 * comparison needs Search Console. Bounded per run so a backlog never turns one drain into
 * hundreds of API calls against a 2,000-a-day quota shared with the audits.
 *
 * asOwner for the selection because this sweeps every tenant; each write goes back through
 * withTenant for its own tenant.
 */
export async function recordTrafficOutcomes(
  db: Database,
  options: TrafficSweepOptions = {},
): Promise<number> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 20
  let config: OAuthConfig
  try {
    config = options.config ?? googleOAuthConfigFromEnv()
  } catch {
    return 0 // Google is not configured on this deployment, so there is nothing to ask.
  }

  const decided = await asOwner(db, (tx) =>
    tx
      .select({
        id: findings.id,
        tenantId: findings.tenantId,
        siteId: findings.siteId,
        affectedUrls: findings.affectedUrls,
        baseline: findings.baseline,
        verification: findings.verification,
        siteUrl: sites.url,
        gscProperty: sites.gscProperty,
      })
      .from(findings)
      .innerJoin(sites, eq(sites.id, findings.siteId))
      .where(
        and(
          inArray(findings.status, ['verified', 'rejected']),
          isNotNull(findings.verification),
          isNotNull(findings.baseline),
        ),
      )
      .orderBy(sql`${findings.trafficCheckedAt} asc nulls first`, findings.id),
  )

  const ready = decided
    .filter(
      (row) =>
        row.verification !== null &&
        !hasTraffic(row.verification) &&
        trafficReadyAt(new Date(row.verification.verifiedAt)).getTime() <= now.getTime(),
    )
    .slice(0, limit)

  for (const row of ready) {
    await withTenant(db, row.tenantId, (tx) =>
      tx.update(findings).set({ trafficCheckedAt: now }).where(eq(findings.id, row.id)),
    )
  }
  let recorded = 0
  const bySite = new Map<string, typeof ready>()
  for (const row of ready) bySite.set(row.siteId, [...(bySite.get(row.siteId) ?? []), row])

  for (const rows of bySite.values()) {
    const first = rows[0]!
    const console_ = await openSearchConsole(
      db,
      { tenantId: first.tenantId, siteUrl: first.siteUrl, gscProperty: first.gscProperty },
      { config, ...(options.fetch ? { fetch: options.fetch } : {}) },
    ).catch(() => null)
    if (!console_) continue

    for (const row of rows) {
      const verification = row.verification!
      const openedAt = new Date(row.baseline?.capturedAt ?? verification.before.capturedAt)
      const windows = trafficWindows(openedAt, new Date(verification.verifiedAt))
      try {
        const [before, after] = await Promise.all([
          measurePageTraffic(console_.gsc, console_.property, row.affectedUrls, windows.before),
          measurePageTraffic(console_.gsc, console_.property, row.affectedUrls, windows.after),
        ])
        await withTenant(db, row.tenantId, (tx) =>
          tx
            .update(findings)
            .set({ verification: addTraffic(verification, before, after, now) })
            .where(eq(findings.id, row.id)),
        )
        recorded += 1
      } catch (error) {
        console.warn(`traffic: could not measure finding ${row.id}:`, String(error).slice(0, 200))
      }
    }
  }
  return recorded
}
