export { runAudit } from './run.js'
export type { AuditResult, RunAuditOptions } from './run.js'

export {
  clearFixError,
  getAudit,
  getAuditProgress,
  getFinding,
  getFixProgress,
  listSites,
  listFindings,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './queries.js'
export type {
  AuditDetail,
  AuditProgress,
  FixProgress,
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

export { measureVisibility, visibilityReport, VISIBILITY_WINDOW_DAYS } from './visibility.js'
export type { VisibilityReport, VisibilityResult } from './visibility.js'

export { measureAuthority, MAX_COMPARED_COMPETITORS } from './authority.js'
export { openSearchConsole, siteQueries } from './search.js'
export { runQuickCheck, summarisePage } from './quick-check.js'
export { captureCompetitorNames, nameCompetitors } from './competitor-names.js'
export type { CompetitorNames, ReadHomepage } from './competitor-names.js'
export type { PageSummary, QuickCheckOptions, QuickCheckResult } from './quick-check.js'
export { measureTopics, MAX_EMBEDDED_PAGES, pageText } from './topics.js'
export type { NameClusters, TopicsLlm, TopicsResult } from './topics.js'
export { clusterByCosine, cosine, SIMILARITY_THRESHOLD, similarityThresholdFor } from './cluster.js'
export type { AuthorityResult } from './authority.js'

export { reconcileFixVerifications, stillPresent } from './verify-fixes.js'
export {
  baselineFor,
  failingPagesMetric,
  stillFailingCount,
  verificationFor,
} from './outcome-evidence.js'
export type { MergedFindingRef, FixVerdict } from './verify-fixes.js'

export { E2E, seedE2E } from './seed.js'
export { SHOWCASE, seedShowcase, showcaseDrafts } from './seed-showcase.js'
export {
  applyFixPrOutcome,
  applyFixPrRevert,
  applyVerifyPrOutcome,
  pullRequestNumberFrom,
  revertedPullRequestNumber,
} from './pr-outcome.js'
export type { OutcomeEffect, PullRequestOutcome } from './pr-outcome.js'

export { listOutcomes, OUTCOME_STATUSES } from './outcomes.js'
export type { FixOutcome, OutcomeStatus, SiteOutcomes } from './outcomes.js'
export {
  addTraffic,
  CLICKS_METRIC,
  hasTraffic,
  IMPRESSIONS_METRIC,
  measurePageTraffic,
  trafficReadyAt,
  trafficWindows,
} from './traffic-outcome.js'
export type { PageTraffic } from './traffic-outcome.js'
export { diffFindings, getAuditChanges, HISTORY_LIMIT, listSiteAudits } from './history.js'
export type { AuditChanges, AuditHistoryEntry, AxisPoint, ChangedFinding } from './history.js'
export { listFixAttempts } from './fix-attempts.js'
export type { FixAttempt } from './fix-attempts.js'
export { fixPrRates } from './fix-pr-rates.js'
export type { FixPrRates } from './fix-pr-rates.js'
export { earlierFindings, earlierWorkOf, fingerprintAll, fingerprintOf } from './fingerprint.js'
export type { EarlierFinding, EarlierWork } from './fingerprint.js'

// Competitor watch (ADR-0034): weekly snapshots of tracked competitors, diffed, beside citations.
export { MAX_WATCHED_PAGES, takeSnapshot } from './competitors/snapshot.js'
export type { CompetitorSnapshot, WatchedPage } from './competitors/snapshot.js'
export { diffSnapshots, MAX_NEW_URLS } from './competitors/diff.js'
export type { ChangeKind, CompetitorChange } from './competitors/diff.js'
export {
  CHANGE_RETENTION_DAYS,
  WATCH_INTERVAL_DAYS,
  watchCompetitors,
} from './competitors/watch.js'
export {
  CITATION_WINDOW_DAYS,
  citationWindows,
  competitorWatchReport,
} from './competitors/report.js'
export type {
  ChangeBatch,
  CitationWindow,
  CompetitorWatchReport,
  WatchedChange,
  WatchedCompetitor,
} from './competitors/report.js'

// What the topic map advises (ADR-0035).
export { evaluateClusterHubs, evaluateQuestionCoverage, HUB_MIN_PAGES } from './topic-findings.js'

// A site's own details: its name, what it offers, where its customers are, and its competitors.
export {
  captureBrand,
  getSiteProfile,
  MAX_BRAND,
  MAX_MARKET,
  MAX_OFFERING,
  saveCompetitors,
  saveSiteProfile,
} from './site-profile.js'
export type { SiteProfile } from './site-profile.js'
