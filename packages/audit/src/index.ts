export { runAudit } from './run.js'
export type { AuditResult, RunAuditOptions } from './run.js'

export {
  getAudit,
  getAuditProgress,
  getFinding,
  listSites,
  listFindings,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './queries.js'
export type {
  AuditDetail,
  AuditProgress,
  SiteSummary,
  FindingListItem,
  FindingFilters,
  FindingPage,
  FindingSort,
} from './queries.js'

export {
  getVisibilitySettings,
  normaliseCompetitors,
  normalisePrompts,
  saveVisibilitySettings,
  MAX_COMPETITORS,
  MAX_PROMPTS,
  MAX_PROMPT_LENGTH,
} from './prompts.js'
export type { VisibilitySettings } from './prompts.js'

export { measureVisibility, VISIBILITY_WINDOW_DAYS } from './visibility.js'
export type { VisibilityResult } from './visibility.js'

export { measureAuthority, MAX_COMPARED_COMPETITORS } from './authority.js'
export type { AuthorityResult } from './authority.js'

export { reconcileFixVerifications, stillPresent } from './verify-fixes.js'
export type { MergedFindingRef, FixVerdict } from './verify-fixes.js'

export { E2E, seedE2E } from './seed.js'
