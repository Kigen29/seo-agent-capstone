import type { Axis, Scorecard, Severity } from '@seo/core'
import { audits, findings, withTenant, type Database } from '@seo/db'
import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm'

/**
 * Every audit of a site, and what changed between one and the next.
 *
 * Audits were always kept: each run writes its own row and its own findings, and nothing is
 * overwritten. What was missing was any way to read them as a sequence. The dashboard showed the
 * newest audit and the rest were unreachable, so the one question the product exists to answer
 * ("did the fix work, and did anything else break?") could not be asked of its own records.
 *
 * Two audits are compared by finding identity (ADR-0029): a fingerprint of the rule and what the
 * finding is about, which is the same on every audit that raises the same issue. An issue in the
 * earlier audit and absent from the later one was resolved; the reverse is new. No model, no
 * heuristics, and the same two audits always compare the same way.
 */

export interface AxisPoint {
  axis: Axis
  /** Null when the axis was not measured in that audit. Never read as zero. */
  score: number | null
}

export interface AuditHistoryEntry {
  id: string
  status: string
  startedAt: Date
  completedAt: Date | null
  pagesCrawled: number
  error: string | null
  scores: AxisPoint[]
  findings: number
  /** Against the completed audit before this one. Null when there is none to compare with. */
  changes: { resolved: number; added: number } | null
}

export interface ChangedFinding {
  rowId: string
  ruleId: string
  title: string
  severity: Severity
  axis: Axis
  status: string
  /** The pull request on the finding, when one was opened for it. */
  prUrl: string | null
}

export interface AuditChanges {
  previous: { id: string; startedAt: Date } | null
  next: { id: string; startedAt: Date } | null
  /** In the previous audit and not in this one. Rows are the previous audit's. */
  resolved: ChangedFinding[]
  /** In this audit and not in the previous one. Rows are this audit's. */
  added: ChangedFinding[]
  /** In both. */
  carried: number
  scores: { axis: Axis; before: number | null; after: number | null }[]
  /** Pages crawled then and now: a smaller crawl can make an issue vanish without fixing it. */
  pages: { before: number; after: number } | null
}

interface IdentityRow {
  id: string
  auditId: string
  ruleId: string
  title: string
  severity: Severity
  axis: Axis
  status: string
  prUrl: string | null
  fingerprint: string | null
}

/** Findings written before fingerprints existed are matched by rule and title, which is close. */
const identityOf = (row: Pick<IdentityRow, 'fingerprint' | 'ruleId' | 'title'>): string =>
  row.fingerprint ?? `${row.ruleId}|${row.title}`

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

const bySeverity = (a: ChangedFinding, b: ChangedFinding): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
  a.ruleId.localeCompare(b.ruleId) ||
  a.title.localeCompare(b.title)

const changed = (row: IdentityRow): ChangedFinding => ({
  rowId: row.id,
  ruleId: row.ruleId,
  title: row.title,
  severity: row.severity,
  axis: row.axis,
  status: row.status,
  prUrl: row.prUrl,
})

/** What is in one list and not the other, by identity. Pure. */
export function diffFindings(
  before: readonly IdentityRow[],
  after: readonly IdentityRow[],
): { resolved: ChangedFinding[]; added: ChangedFinding[]; carried: number } {
  const earlier = new Set(before.map(identityOf))
  const later = new Set(after.map(identityOf))

  return {
    resolved: before
      .filter((row) => !later.has(identityOf(row)))
      .map(changed)
      .sort(bySeverity),
    added: after
      .filter((row) => !earlier.has(identityOf(row)))
      .map(changed)
      .sort(bySeverity),
    carried: after.filter((row) => earlier.has(identityOf(row))).length,
  }
}

const scoresOf = (scorecard: Scorecard | null | undefined): AxisPoint[] =>
  (scorecard?.axes ?? []).map((axis) => ({ axis: axis.axis, score: axis.score }))

const identityColumns = {
  id: findings.id,
  auditId: findings.auditId,
  ruleId: findings.ruleId,
  title: findings.title,
  severity: findings.severity,
  axis: findings.axis,
  status: findings.status,
  prUrl: findings.prUrl,
  fingerprint: findings.fingerprint,
}

/** How many audits a history page shows. A site audited weekly reaches this in about a year. */
export const HISTORY_LIMIT = 50

/**
 * A site's audits, newest first, each with its scores and what changed since the one before.
 * Undefined when the site is not the caller's, which the route reports as a 404.
 */
export async function listSiteAudits(
  db: Database,
  tenantId: string,
  siteId: string,
  limit: number = HISTORY_LIMIT,
): Promise<AuditHistoryEntry[]> {
  return withTenant(db, tenantId, async (tx) => {
    // One more than shown, so the oldest row on the page still has something to compare with.
    const rows = await tx
      .select()
      .from(audits)
      .where(eq(audits.siteId, siteId))
      .orderBy(desc(audits.startedAt))
      .limit(limit + 1)
    if (rows.length === 0) return []

    const found = (await tx
      .select(identityColumns)
      .from(findings)
      .where(
        inArray(
          findings.auditId,
          rows.map((row) => row.id),
        ),
      )) as IdentityRow[]

    const byAudit = new Map<string, IdentityRow[]>()
    for (const row of found) byAudit.set(row.auditId, [...(byAudit.get(row.auditId) ?? []), row])

    return rows.slice(0, limit).map((audit, index) => {
      const own = byAudit.get(audit.id) ?? []
      // A failed or unfinished audit found nothing because it did not look, so it is neither
      // compared nor compared against: that would report every issue as resolved.
      const earlier =
        audit.status === 'complete'
          ? rows.slice(index + 1).find((candidate) => candidate.status === 'complete')
          : undefined
      const diff = earlier ? diffFindings(byAudit.get(earlier.id) ?? [], own) : null

      return {
        id: audit.id,
        status: audit.status,
        startedAt: audit.startedAt,
        completedAt: audit.completedAt,
        pagesCrawled: audit.pagesCrawled,
        error: audit.error,
        scores: scoresOf(audit.scorecard),
        findings: own.length,
        changes: diff ? { resolved: diff.resolved.length, added: diff.added.length } : null,
      }
    })
  })
}

/** One audit against the completed audit before it. Undefined when the audit is not the caller's. */
export async function getAuditChanges(
  db: Database,
  tenantId: string,
  auditId: string,
): Promise<AuditChanges | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [audit] = await tx.select().from(audits).where(eq(audits.id, auditId)).limit(1)
    if (!audit) return undefined

    const [previous] = await tx
      .select()
      .from(audits)
      .where(
        and(
          eq(audits.siteId, audit.siteId),
          eq(audits.status, 'complete'),
          lt(audits.startedAt, audit.startedAt),
        ),
      )
      .orderBy(desc(audits.startedAt))
      .limit(1)
    const [next] = await tx
      .select({ id: audits.id, startedAt: audits.startedAt })
      .from(audits)
      .where(and(eq(audits.siteId, audit.siteId), gt(audits.startedAt, audit.startedAt)))
      .orderBy(asc(audits.startedAt))
      .limit(1)

    const nothing: AuditChanges = {
      previous: previous ? { id: previous.id, startedAt: previous.startedAt } : null,
      next: next ?? null,
      resolved: [],
      added: [],
      carried: 0,
      scores: [],
      pages: null,
    }
    if (!previous || audit.status !== 'complete') return nothing

    const rows = (await tx
      .select(identityColumns)
      .from(findings)
      .where(inArray(findings.auditId, [audit.id, previous.id]))) as IdentityRow[]
    const diff = diffFindings(
      rows.filter((row) => row.auditId === previous.id),
      rows.filter((row) => row.auditId === audit.id),
    )

    const before = new Map(scoresOf(previous.scorecard).map((point) => [point.axis, point.score]))
    return {
      ...nothing,
      ...diff,
      scores: scoresOf(audit.scorecard).map((point) => ({
        axis: point.axis,
        before: before.get(point.axis) ?? null,
        after: point.score,
      })),
      pages: { before: previous.pagesCrawled, after: audit.pagesCrawled },
    }
  })
}
