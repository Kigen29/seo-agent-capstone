import type { MetricSnapshot, Severity, VerificationResult } from '@seo/core'
import { findings, sites, withTenant, type Database } from '@seo/db'
import { and, desc, eq, inArray } from 'drizzle-orm'

/**
 * Every fix the agent has proposed for a site, and what became of it.
 *
 * The read side of outcome reporting. A finding enters this list when its pull request is recorded
 * and stays for good: a rejected fix is as much an outcome as a verified one, and hiding the ones
 * that did not work would make the page an advertisement instead of a report.
 */

export type OutcomeStatus = 'pr_open' | 'merged' | 'verified' | 'rejected'

export const OUTCOME_STATUSES: readonly OutcomeStatus[] = [
  'pr_open',
  'merged',
  'verified',
  'rejected',
]

export interface FixOutcome {
  rowId: string
  ruleId: string
  title: string
  severity: Severity
  status: OutcomeStatus
  prUrl: string | null
  /** How we would know the fix failed, stated before the fix was written. */
  falsification: string
  baseline: MetricSnapshot | null
  verification: VerificationResult | null
  /** Why the last check could not decide, while a merged fix waits (e.g. no deployment yet). */
  note: string | null
  affectedPages: number
}

export interface SiteOutcomes {
  outcomes: FixOutcome[]
  counts: Record<OutcomeStatus, number>
}

/** Null when the site is not the tenant's, so the route can answer 404 rather than an empty list. */
export async function listOutcomes(
  db: Database,
  tenantId: string,
  siteId: string,
): Promise<SiteOutcomes | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) return null

    const rows = await tx
      .select({
        rowId: findings.id,
        ruleId: findings.ruleId,
        title: findings.title,
        severity: findings.severity,
        status: findings.status,
        prUrl: findings.prUrl,
        falsification: findings.falsification,
        baseline: findings.baseline,
        verification: findings.verification,
        fixError: findings.fixError,
        affectedUrls: findings.affectedUrls,
      })
      .from(findings)
      .where(and(eq(findings.siteId, siteId), inArray(findings.status, [...OUTCOME_STATUSES])))
      .orderBy(desc(findings.createdAt))

    const counts: Record<OutcomeStatus, number> = {
      pr_open: 0,
      merged: 0,
      verified: 0,
      rejected: 0,
    }
    const outcomes = rows.map((row) => {
      const status = row.status as OutcomeStatus
      counts[status] += 1
      return {
        rowId: row.rowId,
        ruleId: row.ruleId,
        title: row.title,
        severity: row.severity,
        status,
        prUrl: row.prUrl ?? null,
        falsification: row.falsification,
        baseline: row.baseline ?? null,
        verification: row.verification ?? null,
        // A merged fix's fixError holds why the last verification was inconclusive.
        note: status === 'merged' ? (row.fixError ?? null) : null,
        affectedPages: row.affectedUrls.length,
      }
    })

    return { outcomes, counts }
  })
}
