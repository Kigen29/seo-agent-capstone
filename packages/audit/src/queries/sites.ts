import type { Scorecard, VerificationStatus } from '@seo/core'
import { audits, type Database, sites, visibilityPrompts, withTenant } from '@seo/db'
import { desc, sql } from 'drizzle-orm'

/** The site list, with the latest audit of each site. */

export interface SiteSummary {
  id: string
  url: string
  /** The connected repository, "owner/name", or null until the GitHub App is installed on it. */
  repoFullName: string | null
  /** Where the site is in the Search Console verification lifecycle. */
  gscVerificationStatus: VerificationStatus
  /** The open or merged verification PR, if one has been opened. */
  gscVerificationPrUrl: string | null
  /** A Google Business Profile link is attached (it carried a CID or a Place ID). */
  businessProfileConnected: boolean
  /** How many AI-visibility questions are tracked for this site. */
  trackedPrompts: number
  latestAudit?: {
    id: string
    status: string
    pagesCrawled: number
    startedAt: Date
    scorecard: Scorecard | null
  }
}

/**
 * Every site the tenant owns, each with its latest audit.
 *
 * This was an N+1: one `SELECT *` for the sites, then one more per site for its newest audit. On a
 * single drizzle transaction that is also serial, because a transaction is one connection, so
 * `Promise.all` around it parallelises nothing. Forty sites meant forty-one round trips in
 * sequence, on a pool capped at five.
 *
 * Two queries now. The second uses `DISTINCT ON` to pick the newest audit per site inside the
 * database, and both name their columns rather than `SELECT *`: the sites table alone carries
 * competitors, brand, framework and the installation id, none of which this list renders.
 */
export async function listSites(db: Database, tenantId: string): Promise<SiteSummary[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: sites.id,
        url: sites.url,
        repoFullName: sites.repoFullName,
        gscVerificationStatus: sites.gscVerificationStatus,
        gscVerificationPrUrl: sites.gscVerificationPrUrl,
        gbpCid: sites.gbpCid,
        gbpPlaceId: sites.gbpPlaceId,
      })
      .from(sites)
      .orderBy(desc(sites.createdAt))

    if (rows.length === 0) return []

    const latest = await tx
      .selectDistinctOn([audits.siteId], {
        siteId: audits.siteId,
        id: audits.id,
        status: audits.status,
        pagesCrawled: audits.pagesCrawled,
        startedAt: audits.startedAt,
        scorecard: audits.scorecard,
      })
      .from(audits)
      .orderBy(audits.siteId, desc(audits.startedAt))

    const bySite = new Map(latest.map((audit) => [audit.siteId, audit]))

    // One grouped count rather than a query per site, so the dashboard's setup checklist can say
    // how many questions are tracked without loading them.
    const promptCounts = await tx
      .select({ siteId: visibilityPrompts.siteId, count: sql<number>`count(*)::int` })
      .from(visibilityPrompts)
      .groupBy(visibilityPrompts.siteId)
    const promptsBySite = new Map(promptCounts.map((row) => [row.siteId, Number(row.count)]))

    return rows.map((site) => {
      const audit = bySite.get(site.id)
      return {
        id: site.id,
        url: site.url,
        repoFullName: site.repoFullName ?? null,
        gscVerificationStatus: site.gscVerificationStatus,
        gscVerificationPrUrl: site.gscVerificationPrUrl ?? null,
        businessProfileConnected: Boolean(site.gbpCid || site.gbpPlaceId),
        trackedPrompts: promptsBySite.get(site.id) ?? 0,
        latestAudit: audit
          ? {
              id: audit.id,
              status: audit.status,
              pagesCrawled: audit.pagesCrawled,
              startedAt: audit.startedAt,
              scorecard: audit.scorecard ?? null,
            }
          : undefined,
      }
    })
  })
}
