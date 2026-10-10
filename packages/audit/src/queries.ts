/**
 * The read side. Everything the dashboard needs, and nothing that writes.
 *
 * Every function here goes through `withTenant`, so Postgres scopes the rows and a bug in
 * these files produces an empty page rather than another tenant's data. See ADR-0008.
 *
 * The queries live in `queries/` by what they read, and this module re-exports all of them, so
 * an import of `./queries.js` is unchanged.
 *
 *   sites         the site list, with each site's latest audit
 *   findings      the inbox page, and one finding in full
 *   audits        one audit with its findings, and its progress while it runs
 *   fix-progress  where a requested fix has got to
 *   finding-row   a stored finding as the domain type, shared by two of the above
 */

export { getAudit, getAuditProgress } from './queries/audits.js'
export type { AuditDetail, AuditProgress } from './queries/audits.js'
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, getFinding, listFindings } from './queries/findings.js'
export type {
  FindingFilters,
  FindingListItem,
  FindingPage,
  FindingSort,
} from './queries/findings.js'
export { clearFixError, getFixProgress } from './queries/fix-progress.js'
export type { FixProgress } from './queries/fix-progress.js'
export { listSites } from './queries/sites.js'
export type { SiteSummary } from './queries/sites.js'
