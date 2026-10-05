import { createHash } from 'node:crypto'
import { findings, type Database } from '@seo/db'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'

/**
 * What makes a finding the same finding on the next audit (ADR-0029).
 *
 * A finding's `key` ('TECH-004#3') is its position in one audit's output. It keeps the inbox from
 * reshuffling on refresh and it is useless across audits: add a page and every later index moves.
 * So each audit's findings were strangers to the last one's. A finding with a pull request open
 * vanished from the inbox on the next audit and the same issue reappeared as untouched, offering a
 * second pull request; "won't fix" was forgotten every time; and nothing could say how long an
 * issue had been open.
 *
 * The fingerprint is the rule plus what the finding is about: by default the first affected URL,
 * or a `subject` the rule supplies when its URL list is not stable (a duplicate title is about the
 * title, whichever pages currently share it). A hash rather than the raw string so it is a fixed
 * width to index and compare, and deterministic so nothing has to be looked up to compute it.
 */
export interface Fingerprintable {
  ruleId: string
  title: string
  affectedUrls: readonly string[]
  subject?: string | undefined
}

const hash = (ruleId: string, subject: string): string =>
  createHash('sha256').update(`${ruleId}|${subject}`, 'utf8').digest('hex')

/** One finding's fingerprint. Must stay equal to the backfill in migration 0030. */
export function fingerprintOf(finding: Fingerprintable): string {
  return hash(finding.ruleId, finding.subject ?? finding.affectedUrls[0] ?? '')
}

/**
 * Fingerprints for a whole audit, unique within it.
 *
 * Two findings from one rule about one subject are rare but legal (two insecure resources on one
 * page). They are told apart by an ordinal assigned in title order, which is deterministic and
 * does not depend on how the engine happened to order them. The first keeps the plain fingerprint,
 * so the common case matches the migration's backfill exactly.
 */
export function fingerprintAll<T extends Fingerprintable>(found: readonly T[]): Map<T, string> {
  const groups = new Map<string, T[]>()
  for (const finding of found) {
    const base = fingerprintOf(finding)
    groups.set(base, [...(groups.get(base) ?? []), finding])
  }

  const out = new Map<T, string>()
  for (const [base, group] of groups) {
    const ordered = [...group].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    ordered.forEach((finding, index) => {
      out.set(finding, index === 0 ? base : hash(finding.ruleId, `${base}#${index + 1}`))
    })
  }
  return out
}

/** The most recent earlier record of the same issue on the same site. */
export interface EarlierFinding {
  rowId: string
  status: (typeof findings.$inferSelect)['status']
  prUrl: string | null
  firstSeenAt: Date
}

/**
 * For each fingerprint, the newest finding on this site from a different audit.
 *
 * Must run inside the caller's tenant-scoped transaction. One query for the whole set: an audit
 * produces hundreds of findings and a lookup per finding would be hundreds of round trips.
 */
export async function earlierFindings(
  tx: Database,
  siteId: string,
  fingerprints: readonly string[],
  excludeAuditId: string,
): Promise<Map<string, EarlierFinding>> {
  if (fingerprints.length === 0) return new Map()

  const rows = await tx
    .selectDistinctOn([findings.fingerprint], {
      fingerprint: findings.fingerprint,
      rowId: findings.id,
      status: findings.status,
      prUrl: findings.prUrl,
      firstSeenAt: findings.firstSeenAt,
    })
    .from(findings)
    .where(
      and(
        eq(findings.siteId, siteId),
        inArray(findings.fingerprint, [...new Set(fingerprints)]),
        ne(findings.auditId, excludeAuditId),
      ),
    )
    .orderBy(findings.fingerprint, desc(findings.createdAt), desc(findings.id))

  return new Map(
    rows.flatMap((row) =>
      row.fingerprint
        ? [
            [
              row.fingerprint,
              {
                rowId: row.rowId,
                status: row.status,
                prUrl: row.prUrl ?? null,
                firstSeenAt: row.firstSeenAt,
              },
            ] as const,
          ]
        : [],
    ),
  )
}

/**
 * What earlier work on the same issue means for a finding raised again.
 *
 *   in_progress: a pull request is open or merged and not yet checked. Offering another fix
 *                would open a duplicate, so the fix button gives way to a link.
 *   regressed:   it was fixed and verified, and it is back.
 *   fix_failed:  a merged fix was checked and did not work.
 *
 * Open and won't-fix earlier records mean nothing here: open is simply "still there", and
 * won't-fix is carried onto the new finding's own status when it is written.
 */
export type EarlierWork = 'in_progress' | 'regressed' | 'fix_failed'

export function earlierWorkOf(status: EarlierFinding['status']): EarlierWork | null {
  if (status === 'pr_open' || status === 'merged') return 'in_progress'
  if (status === 'verified') return 'regressed'
  if (status === 'rejected') return 'fix_failed'
  return null
}
