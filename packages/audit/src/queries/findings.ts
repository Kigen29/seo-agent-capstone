import type { Axis, Effort, Finding, FindingStatus, Severity } from '@seo/core'
import { audits, type Database, findings, sites, withTenant } from '@seo/db'
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { earlierFindings, type EarlierWork } from '../fingerprint.js'
import { earlierOf, toFinding } from './finding-row.js'

/** The findings inbox, filtered, sorted and paged in SQL, and one finding in full. */

/**
 * One row of the findings inbox: enough to list and prioritise, not the full evidence.
 *
 * `affectedUrls` is deliberately gone and replaced by a count. It was an entire array of URLs per
 * finding, serialised into every inbox response, for a column the inbox never rendered: a tenant
 * with ten sites, forty findings each and a couple of hundred affected pages per finding shipped
 * megabytes to draw a table of titles. The count is what the list actually shows.
 */
export interface FindingListItem {
  rowId: string
  siteId: string
  siteUrl: string
  ruleId: string
  axis: Axis
  severity: Severity
  title: string
  fixable: boolean
  status: FindingStatus
  estimatedImpact: number
  estimatedEffort: Effort
  affectedUrlCount: number
  /**
   * Whether the last attempt to fix this failed. A flag, not the message: the reason belongs on
   * the finding page where there is room to read it, and the same reasoning that removed
   * `affectedUrls` from this shape applies to a paragraph of error text on every row.
   */
  fixFailed: boolean
  /** When this issue was first raised on the site, across audits. ISO 8601. */
  firstSeenAt: string
  /** Earlier work on the same issue, from a previous audit's record of it. Null when none. */
  earlier: { work: EarlierWork; rowId: string; prUrl: string | null } | null
}

/** What the caller may narrow the inbox by. Every field is optional and independent. */
export interface FindingFilters {
  siteId?: string
  axis?: Axis
  severity?: Severity
  status?: FindingStatus
  fixable?: boolean
  /** Case-insensitive substring of the title or the rule id. */
  q?: string
}

export type FindingSort = 'priority' | 'severity' | 'title' | 'axis'

export interface FindingPage {
  findings: FindingListItem[]
  /** Matching rows before the limit, so the UI can render page numbers and a real count. */
  total: number
  page: number
  pageSize: number
}

/** Bounded so a caller cannot ask for the unpaginated behaviour this replaced. */
export const MAX_PAGE_SIZE = 100

export const DEFAULT_PAGE_SIZE = 25

const SORT_COLUMN = {
  priority: findings.priorityScore,
  severity: findings.severity,
  title: findings.title,
  axis: findings.axis,
} as const

/**
 * The findings inbox: one page of the tenant's current findings, most important first.
 *
 * "Current" means the latest audit per site, not every audit ever, so re-running an audit replaces
 * a site's findings in the list rather than stacking a second copy beside the first.
 *
 * This used to load everything. It read every audit row the tenant had ever created to work out
 * the latest per site, deduplicated them in JavaScript, selected every finding across all of them
 * with no limit, and then sorted the whole result set in Node. Three things follow from that last
 * step: the sort could not be pushed into SQL, `LIMIT` therefore could never be applied, and the
 * inbox got slower for the rest of a tenant's life with every audit they ran.
 *
 * Now the score is a stored column (see the `findings` table), so ordering, filtering and paging
 * are all one indexed query, and the response size is fixed regardless of how much history exists.
 */
export async function listFindings(
  db: Database,
  tenantId: string,
  options: FindingFilters & { page?: number; pageSize?: number; sort?: FindingSort } = {},
): Promise<FindingPage> {
  const pageSize = Math.min(Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const page = Math.max(1, options.page ?? 1)

  return withTenant(db, tenantId, async (tx) => {
    /**
     * The latest audit per site, in SQL rather than by reading every audit and deduplicating in a
     * Map. `DISTINCT ON` is Postgres-specific and exactly the right tool: ordered by site then by
     * recency, it keeps the first row per site and discards the rest inside the database.
     */
    const latest = await tx
      .selectDistinctOn([audits.siteId], { auditId: audits.id })
      .from(audits)
      .where(eq(audits.status, 'complete'))
      .orderBy(audits.siteId, desc(audits.startedAt))

    const auditIds = latest.map((row) => row.auditId)
    if (auditIds.length === 0) return { findings: [], total: 0, page, pageSize }

    const predicates = [inArray(findings.auditId, auditIds)]
    if (options.siteId) predicates.push(eq(findings.siteId, options.siteId))
    if (options.axis) predicates.push(eq(findings.axis, options.axis))
    if (options.severity) predicates.push(eq(findings.severity, options.severity))
    if (options.status) predicates.push(eq(findings.status, options.status))
    if (options.fixable !== undefined) predicates.push(eq(findings.fixable, options.fixable))
    if (options.q?.trim()) {
      // Escape the LIKE wildcards, or a user searching for "100%" matches everything.
      const term = `%${options.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      predicates.push(or(ilike(findings.title, term), ilike(findings.ruleId, term))!)
    }

    const where = and(...predicates)

    const [counted] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(findings)
      .where(where)

    const column = SORT_COLUMN[options.sort ?? 'priority']

    const rows = await tx
      .select({
        rowId: findings.id,
        siteId: findings.siteId,
        siteUrl: sites.url,
        ruleId: findings.ruleId,
        axis: findings.axis,
        severity: findings.severity,
        title: findings.title,
        fixable: findings.fixable,
        status: findings.status,
        estimatedImpact: findings.estimatedImpact,
        estimatedEffort: findings.estimatedEffort,
        // Counted in the database rather than shipped and measured in the browser.
        affectedUrlCount: sql<number>`coalesce(array_length(${findings.affectedUrls}, 1), 0)`,
        // Reduced to a boolean in SQL, so a paragraph of error text is not serialised onto every
        // row of every page to render one badge.
        fixFailed: sql<boolean>`${findings.fixError} is not null`,
        firstSeenAt: findings.firstSeenAt,
        fingerprint: findings.fingerprint,
        auditId: findings.auditId,
      })
      .from(findings)
      .innerJoin(sites, eq(findings.siteId, sites.id))
      .where(where)
      /**
       * `id` is the tie-breaker, and it is not decoration. Without a total order, two rows with
       * the same priority can come back in either order between queries, so a row can appear on
       * both page one and page two, or on neither. Pagination without a deterministic sort quietly
       * loses rows.
       */
      .orderBy(desc(column), desc(findings.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    /**
     * Earlier work on each issue, looked up for this page of rows only, one query per site on the
     * page. Usually that is one site and one query; it never grows with the size of the inbox.
     */
    const bySite = new Map<string, typeof rows>()
    for (const row of rows) bySite.set(row.siteId, [...(bySite.get(row.siteId) ?? []), row])
    const earlierByRow = new Map<string, FindingListItem['earlier']>()
    for (const [siteId, siteRows] of bySite) {
      const earlier = await earlierFindings(
        tx,
        siteId,
        siteRows.flatMap((row) => (row.fingerprint ? [row.fingerprint] : [])),
        siteRows[0]!.auditId,
      )
      for (const row of siteRows) {
        earlierByRow.set(row.rowId, earlierOf(row.status, earlier.get(row.fingerprint ?? '')))
      }
    }

    return {
      findings: rows.map(({ fingerprint: _fingerprint, auditId: _auditId, ...row }) => ({
        ...row,
        firstSeenAt: row.firstSeenAt.toISOString(),
        earlier: earlierByRow.get(row.rowId) ?? null,
      })),
      total: counted?.total ?? 0,
      page,
      pageSize,
    }
  })
}

export async function getFinding(
  db: Database,
  tenantId: string,
  rowId: string,
): Promise<
  | (Finding & {
      rowId: string
      auditId: string
      firstSeenAt: string
      earlier: FindingListItem['earlier']
    })
  | undefined
> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(findings).where(eq(findings.id, rowId)).limit(1)
    if (!row) return undefined

    const earlier = row.fingerprint
      ? await earlierFindings(tx, row.siteId, [row.fingerprint], row.auditId)
      : new Map()

    return {
      ...toFinding(row),
      auditId: row.auditId,
      firstSeenAt: row.firstSeenAt.toISOString(),
      earlier: earlierOf(row.status, earlier.get(row.fingerprint ?? '')),
    }
  })
}
