import { applyMentionExclusions } from '@seo/connectors'
import type { AuditMetrics, Finding, Scorecard } from '@seo/core'
import { audits, type Database, findings, sites, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import { toFinding } from './finding-row.js'

/** One audit with its findings, and its progress while it runs. */

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
  /** What each axis measured, when the audit recorded it. Null on audits older than the column. */
  metrics: AuditMetrics | null
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
      /*
        Read through the site's current "not us" list, so excluding a site changes the figures
        on screen at once. The stored audit is not rewritten: it is a record of what was
        measured, and undoing an exclusion has to be able to bring a site back.
      */
      metrics: audit.metrics?.authority
        ? {
            ...audit.metrics,
            authority: applyMentionExclusions(audit.metrics.authority, site.mentionExclusions),
          }
        : (audit.metrics ?? null),
      findings: rows.map(toFinding),
    }
  })
}

/**
 * Just enough to answer "is it still crawling, and how far has it got".
 *
 * The audit page polls every two seconds while a crawl runs, and it was polling `getAudit`, which
 * returns every finding with its full evidence, baseline and verification JSON. On a large crawl
 * that is megabytes re-serialised every two seconds to read two scalars. Five columns instead.
 */
export interface AuditProgress {
  id: string
  status: string
  pagesCrawled: number
  /** True once there is nothing left to poll for, so the client can stop. */
  finished: boolean
}

export async function getAuditProgress(
  db: Database,
  tenantId: string,
  auditId: string,
): Promise<AuditProgress | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: audits.id, status: audits.status, pagesCrawled: audits.pagesCrawled })
      .from(audits)
      .where(eq(audits.id, auditId))
      .limit(1)

    if (!row) return undefined

    return {
      ...row,
      finished: row.status === 'complete' || row.status === 'failed',
    }
  })
}
