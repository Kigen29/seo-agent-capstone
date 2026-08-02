import {
  type Axis,
  type Effort,
  type Finding,
  type FindingStatus,
  type Scorecard,
  type Severity,
  type VerificationStatus,
} from '@seo/core'
import { audits, findings, sites, withTenant, type Database } from '@seo/db'
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'

/**
 * The read side. Everything the dashboard needs, and nothing that writes.
 *
 * Every function here goes through `withTenant`, so Postgres scopes the rows and a bug in
 * this file produces an empty page rather than another tenant's data. See ADR-0008.
 */

export interface SiteSummary {
  id: string
  url: string
  /** The connected repository, "owner/name", or null until the GitHub App is installed on it. */
  repoFullName: string | null
  /** Where the site is in the Search Console verification lifecycle. */
  gscVerificationStatus: VerificationStatus
  /** The open or merged verification PR, if one has been opened. */
  gscVerificationPrUrl: string | null
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

    return rows.map((site) => {
      const audit = bySite.get(site.id)
      return {
        id: site.id,
        url: site.url,
        repoFullName: site.repoFullName ?? null,
        gscVerificationStatus: site.gscVerificationStatus,
        gscVerificationPrUrl: site.gscVerificationPrUrl ?? null,
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

    return { findings: rows, total: counted?.total ?? 0, page, pageSize }
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
