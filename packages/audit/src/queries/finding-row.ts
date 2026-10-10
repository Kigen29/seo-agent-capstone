import type { Finding, FindingStatus } from '@seo/core'
import { findings } from '@seo/db'
import { type EarlierFinding, earlierWorkOf } from '../fingerprint.js'
import type { FindingListItem } from './findings.js'

/** A stored finding as the domain type, and what earlier work it links to. */

/**
 * What an earlier record of the same issue means for this one, or null.
 *
 * Only an open finding is described by earlier work. One that has moved on has its own pull
 * request and its own outcome, and those are what its page should show.
 */
export function earlierOf(
  status: FindingStatus,
  earlier: EarlierFinding | undefined,
): FindingListItem['earlier'] {
  if (status !== 'open' || !earlier) return null
  const work = earlierWorkOf(earlier.status)
  return work ? { work, rowId: earlier.rowId, prUrl: earlier.prUrl } : null
}

/**
 * A database row is not a Finding. The row carries a surrogate uuid so URLs and foreign
 * keys have something stable to point at; the domain object's `id` is the rule engine's
 * derived key ('TECH-002#0'), which is what the verifier re-checks by name after a fix.
 * Collapsing the two would mean either URLs that break when a crawl is re-run, or a
 * verifier that cannot find the finding it is meant to be verifying.
 */
type FindingRow = typeof findings.$inferSelect

export function toFinding(row: FindingRow): Finding & { rowId: string } {
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
    ...(row.fixError ? { fixError: row.fixError } : {}),
    ...(row.baseline ? { baseline: row.baseline } : {}),
    ...(row.verification ? { verification: row.verification } : {}),
  }
}
