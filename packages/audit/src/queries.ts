import type { Finding, Scorecard } from '@seo/core'
import { audits, findings, sites, withTenant, type Database } from '@seo/db'
import { desc, eq } from 'drizzle-orm'

/**
 * The read side. Everything the dashboard needs, and nothing that writes.
 *
 * Every function here goes through `withTenant`, so Postgres scopes the rows and a bug in
 * this file produces an empty page rather than another tenant's data. See ADR-0008.
 */

export interface SiteSummary {
  id: string
  url: string
  latestAudit?: {
    id: string
    status: string
    pagesCrawled: number
    startedAt: Date
    scorecard: Scorecard | null
  }
}

export async function listSites(db: Database, tenantId: string): Promise<SiteSummary[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.select().from(sites).orderBy(desc(sites.createdAt))

    return Promise.all(
      rows.map(async (site) => {
        const [latest] = await tx
          .select()
          .from(audits)
          .where(eq(audits.siteId, site.id))
          .orderBy(desc(audits.startedAt))
          .limit(1)

        return {
          id: site.id,
          url: site.url,
          latestAudit: latest
            ? {
                id: latest.id,
                status: latest.status,
                pagesCrawled: latest.pagesCrawled,
                startedAt: latest.startedAt,
                scorecard: latest.scorecard ?? null,
              }
            : undefined,
        }
      }),
    )
  })
}

export interface AuditDetail {
  id: string
  siteId: string
  siteUrl: string
  status: string
  pagesCrawled: number
  startedAt: Date
  completedAt: Date | null
  error: string | null
  scorecard: Scorecard | null
  findings: (Finding & { rowId: string })[]
}

export async function getAudit(
  db: Database,
  tenantId: string,
  auditId: string,
): Promise<AuditDetail | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [audit] = await tx.select().from(audits).where(eq(audits.id, auditId)).limit(1)
    if (!audit) return undefined

    const [site] = await tx.select().from(sites).where(eq(sites.id, audit.siteId)).limit(1)

    /**
     * A foreign key with ON DELETE CASCADE means an audit without its site cannot exist, so
     * if we are here the database has been corrupted or the query is scoped wrong.
     *
     * Defaulting to '' would paper over that: the dashboard would render an audit attached
     * to a blank site and look perfectly normal, and the invariant violation would go
     * unnoticed until someone wondered why a row had no URL. An impossible state should be
     * loud, not plausible.
     */
    if (!site) {
      throw new Error(`Audit ${auditId} references site ${audit.siteId}, which does not exist.`)
    }

    const rows = await tx.select().from(findings).where(eq(findings.auditId, auditId))

    return {
      id: audit.id,
      siteId: audit.siteId,
      siteUrl: site.url,
      status: audit.status,
      pagesCrawled: audit.pagesCrawled,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      error: audit.error,
      scorecard: audit.scorecard ?? null,
      findings: rows.map(toFinding),
    }
  })
}

export async function getFinding(
  db: Database,
  tenantId: string,
  rowId: string,
): Promise<(Finding & { rowId: string; auditId: string }) | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(findings).where(eq(findings.id, rowId)).limit(1)
    if (!row) return undefined

    return { ...toFinding(row), auditId: row.auditId }
  })
}

/**
 * A database row is not a Finding. The row carries a surrogate uuid so URLs and foreign
 * keys have something stable to point at; the domain object's `id` is the rule engine's
 * derived key ('TECH-002#0'), which is what the verifier re-checks by name after a fix.
 * Collapsing the two would mean either URLs that break when a crawl is re-run, or a
 * verifier that cannot find the finding it is meant to be verifying.
 */
type FindingRow = typeof findings.$inferSelect

function toFinding(row: FindingRow): Finding & { rowId: string } {
  return {
    rowId: row.id,
    id: row.key,
    siteId: row.siteId,
    ruleId: row.ruleId,
    axis: row.axis,
    severity: row.severity,
    confidence: row.confidence,
    title: row.title,
    evidence: row.evidence,
    affectedUrls: row.affectedUrls,
    estimatedEffort: row.estimatedEffort,
    estimatedImpact: row.estimatedImpact,
    falsification: row.falsification,
    fixable: row.fixable,
    status: row.status,
    ...(row.prUrl ? { prUrl: row.prUrl } : {}),
    ...(row.baseline ? { baseline: row.baseline } : {}),
    ...(row.verification ? { verification: row.verification } : {}),
  }
}
