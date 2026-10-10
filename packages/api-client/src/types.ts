import type { Axis, Effort, Finding, FindingStatus, Scorecard, Severity } from '@seo/core'

/**
 * The shapes the API returns and accepts, as the web app, the CLI and the MCP server see them.
 *
 * Declarations only: nothing in this file runs. They sit apart from the client so that a
 * reader looking for what an endpoint returns is not scrolling through how it is fetched, and
 * the other way round.
 */

export interface HostingStatus {
  /** Whether this deployment can connect to Vercel in one step, by consent. */
  oneClick: boolean
  mode: 'vercel' | 'github'
  connection: {
    projectId: string
    teamId: string | null
    validatedAt: string
    needsReconnect: boolean
  } | null
}

export interface AuditSummary {
  id: string
  status: string
  pagesCrawled: number
  startedAt: string
  scorecard: Scorecard | null
}

export interface Site {
  id: string
  url: string
  /** The connected repository, "owner/name", or null until a repo is connected. */
  repoFullName?: string | null
  /** Where the site is in the Search Console verification lifecycle. */
  gscVerificationStatus?: 'none' | 'pr_open' | 'merged' | 'verified'
  /** The open (or merged) pull request that adds the verification meta tag, if any. */
  gscVerificationPrUrl?: string | null
  /** A Google Business Profile link is attached to this site. */
  businessProfileConnected?: boolean
  /** How many AI-visibility questions are tracked for this site. */
  trackedPrompts?: number
  latestAudit?: AuditSummary
}

/**
 * One row of the findings inbox. Matches the API's list-findings shape.
 *
 * `affectedUrls` used to be here as a full array and is now a count. It was serialised into every
 * inbox response for a column the list never rendered, which on a real tenant is megabytes to
 * draw a table of titles.
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
  /** Whether the last attempt to fix this failed. The reason is on the finding itself. */
  fixFailed: boolean
  /** When this issue was first raised on the site, across audits. ISO 8601. */
  firstSeenAt: string
  earlier: EarlierWork | null
}

/**
 * Earlier work on the same issue, found through a previous audit's record of it.
 *
 *   in_progress: a pull request is open, or merged and not yet checked
 *   regressed:   it was fixed and verified, and it is back
 *   fix_failed:  a merged fix was checked and did not work
 */
export interface EarlierWork {
  work: 'in_progress' | 'regressed' | 'fix_failed'
  /** The earlier finding, which carries the pull request and its outcome. */
  rowId: string
  prUrl: string | null
}

/** What the inbox can be narrowed and ordered by. All optional; the API validates and bounds them. */
export interface FindingQuery {
  siteId?: string
  axis?: Axis
  severity?: Severity
  status?: FindingStatus
  fixable?: boolean
  q?: string
  sort?: 'priority' | 'severity' | 'title' | 'axis'
  page?: number
  pageSize?: number
}

/** One page of findings, plus the total so the UI can render page numbers and a real count. */
export interface FindingPage {
  findings: FindingListItem[]
  total: number
  page: number
  pageSize: number
}

/** What became of each finding in a request for several pull requests. */
export interface BulkFixResult {
  queued: { id: string; title: string }[]
  skipped: { id: string; title: string; reason: string }[]
  /** Eligible findings this request did not reach, because one request is capped. */
  remaining: number
}

/** One audit in a site's history, with what changed since the completed audit before it. */
export interface AuditHistoryEntry {
  id: string
  status: string
  startedAt: string
  completedAt: string | null
  pagesCrawled: number
  error: string | null
  scores: { axis: Axis; score: number | null }[]
  findings: number
  changes: { resolved: number; added: number } | null
}

export interface ChangedFinding {
  rowId: string
  ruleId: string
  title: string
  severity: Severity
  axis: Axis
  status: FindingStatus
  prUrl: string | null
}

/** One audit against the completed audit before it. */
export interface AuditChanges {
  previous: { id: string; startedAt: string } | null
  next: { id: string; startedAt: string } | null
  resolved: ChangedFinding[]
  added: ChangedFinding[]
  carried: number
  scores: { axis: Axis; before: number | null; after: number | null }[]
  pages: { before: number; after: number } | null
}

/** Two scalars, for the poll that runs while a crawl is in flight. */
export interface AuditProgress {
  id: string
  status: string
  pagesCrawled: number
  /** True once there is nothing left to poll for, so the client can stop. */
  finished: boolean
}

/**
 * A drafted outreach email, and the facts it was built on. Never a sent one.
 *
 * `sendPolicy` is carried on the payload rather than being a rule the UI is trusted to remember,
 * so a screen cannot render a draft without the caveat that a human sends it (CLAUDE.md rule 6).
 */
export interface GroundingFact {
  claim: string
  sourceUrl: string
}

export interface OutreachDraft {
  draft: { subject: string; body: string; angle: string }
  sendPolicy: string
  groundedOn: GroundingFact[]
}

/** Who is signed in, for the dashboard to show. Null when the session is a hand-minted token. */
export interface SignedInIdentity {
  provider: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

/**
 * The account behind the session, for the profile and settings screens.
 *
 * The budget is in micro-dollars, like everywhere else it appears, and is formatted once at the
 * edge. Money is never a float in this codebase: a `fast` call costs fractions of a cent and
 * thousands of them have to sum without drift, which an integer gives by construction.
 */
export interface Account {
  tenantName: string | null
  createdAt: string | null
  identity: SignedInIdentity | null
  budget: { capMicros: number; spentMicros: number; reservedMicros?: number; allowed: boolean }
}

/**
 * A session or token that can act as this account. Never carries the token or its hash: the id
 * names the row, and the rest is what a person needs to recognise it before revoking it.
 */
export interface ApiCredential {
  id: string
  name: string
  kind: 'session' | 'token'
  createdAt: string
  lastUsedAt: string | null
  /** Null for a hand-minted token that lives until revoked. */
  expiresAt: string | null
  /** The credential making this request. */
  current: boolean
}

/** The three scalars the finding page polls while a fix job is in flight. */
export interface FixProgress {
  id: string
  status: string
  prUrl: string | null
  fixError: string | null
  /** True once there is nothing left to poll for, so the client can stop. */
  finished: boolean
}

export interface Audit {
  id: string
  siteId: string
  siteUrl: string
  status: string
  pagesCrawled: number
  startedAt: string
  completedAt: string | null
  error: string | null
  scorecard: Scorecard | null
  /** What each axis measured. Null on audits run before the column existed. */
  metrics: AuditMetrics | null
  findings: (Finding & { rowId: string })[]
}

/** A repository the connected GitHub App can see, for the picker. */
export interface PickableRepo {
  fullName: string
  installationId: number
}

/** The two ways connecting a repo can begin: a fresh install, or a pick from an existing one. */
export type ConnectRepoResult =
  { mode: 'install'; url: string } | { mode: 'pick'; repos: PickableRepo[]; manageUrl: string }

/**
 * What a site's AI-visibility axis is configured to measure: the customer questions we poll the
 * answer engines with, and the competitor hosts share of voice is computed against.
 */
export interface VisibilitySettings {
  prompts: string[]
  competitors: string[]
  /**
   * The brand name as a human writes it, for the authority axis. Null until somebody says.
   *
   * It travels with the prompts because it is the same kind of thing: a fact about the business
   * no crawl can discover and no heuristic can guess, typed once and measured against by two
   * different axes.
   */
  brand: string | null
}

/**
 * The Google Business Profile a site belongs to, and what can be built from it.
 *
 * The stored halves and the derived halves travel together so no caller has to know how a profile
 * link is shaped: `cid` and `placeId` are what we hold, `mapsUrl` and `reviewUrl` are what they
 * make. All four are null for a site with no profile connected, which is a real state and not an
 * error, since plenty of sites are not local businesses.
 */
export interface BusinessProfileSettings {
  cid: string | null
  placeId: string | null
  mapsUrl: string | null
  reviewUrl: string | null
}

/** One prompt's poll window: how often we asked, over how many days, and how often we were cited. */
export interface PromptSummary {
  prompt: string
  pollsRun: number
  daysPolled: number
  citedCount: number
  /** citedCount / pollsRun. The plain "cited in k of N" a reader can check. */
  citationRate: number
  /** `insufficient` means not enough polls, or not over enough days, to say anything yet. */
  stability: 'insufficient' | 'unstable' | 'stable' | 'absent'
}

export interface ShareOfVoice {
  client: number
  competitors: { domain: string; citations: number }[]
  /** The client's citations as a fraction of all cited brands'. 0 when nobody was cited. */
  clientShare: number
}

/**
 * The AI-visibility numbers for a site.
 *
 * `note` is present exactly when there is nothing to report, and says which kind of nothing: no
 * prompts configured, none polled yet, or polling but short of a verdict. Those are three
 * different answers and none of them is a zero.
 */
export interface VisibilityReport {
  windowDays: number
  promptsConfigured: number
  promptsMeasured: number
  checksRun: number
  daysPolled: number
  engines: string[]
  prompts: PromptSummary[]
  /** Null when no competitors are configured, which is not a zero share. */
  share: ShareOfVoice | null
  note?: string
}

/** What the authority axis measured on an audit. */
export interface AuthorityMetrics {
  /** Null when no backlink index is configured. NOT the same as a site with no backlinks. */
  referringDomains: number | null
  referringDomainsSampled?: number
  /** Null when mentions were not measured on that audit, though links may have been. */
  earnedDomains: number | null
  selfPublishedDomains: number | null
  /** Domains that mention the brand without linking. Undefined when links were never checked. */
  unlinkedMentions?: string[]
  /**
   * The pages that mention the brand. Undefined on an audit from before they were kept, which is
   * "not recorded", not "none". `linked` is absent when links were never checked.
   */
  /** How the mentions were found: the name searched, and how many results were refused. */
  mentionSearch?: { brand: string; leftOut: number }
  mentions?: {
    url: string
    domain: string
    title?: string
    kind: 'earned' | 'self_published'
    linked?: boolean
  }[]
  /**
   * The link gap: sites linking to every tracked competitor and not to this one.
   *
   * Only the editorial domains are listed, because they are the only ones worth an email. The
   * refused count travels with them so the filtering can be seen rather than trusted: on a small
   * site most of this list is usually link farms, and a tool that printed them as opportunities
   * would be recommending a link scheme.
   */
  linkGap?: {
    editorialDomains: string[]
    refusedAsSpam: number
    directoryDomains: string[]
    comparedWith: string[]
  }
}

export interface SearchMetrics {
  clicks: number
  impressions: number
  /** 0..1. Format once, at the edge. */
  ctr: number
  position: number
  startDate: string
  endDate: string
}

/**
 * What the site is about, measured by grouping pages rather than by asking a model (ADR-0024).
 *
 * `pagesEmbedded` and `pagesCrawled` travel together because every share is a share of the
 * former, and a reader not told that will take the figure for the whole site.
 */
export interface TopicMap {
  pagesEmbedded: number
  pagesCrawled: number
  /** Which embedding model produced the vectors. The map is comparable only within one. */
  model?: string
  clusters: { name: string; share: number; pages: string[] }[]
}

/** The figures an audit recorded, beyond the scorecard. Absent on audits older than the column. */
export interface AuditMetrics {
  authority?: AuthorityMetrics
  search?: SearchMetrics
  topics?: TopicMap
}

/** One keyword idea, with the numbers the vendor reports for it. */
export interface KeywordIdea {
  keyword: string
  /** Average monthly searches. Null when the vendor reports none, which is not the same as zero. */
  searchVolume: number | null
  /**
   * Paid competition, 0 to 1. An **advertising** metric: how many advertisers bid on the term,
   * not how hard it is to rank for organically. The industry routinely renders this as "keyword
   * difficulty" and lets readers believe the second thing.
   */
  competition: number | null
  cpc: number | null
}

export interface KeywordIdeasResult {
  seed: string
  ideas: KeywordIdea[]
  /** Present only when nothing was measured, explaining why. */
  note?: string
}

/** One keyword a competitor ranks for and this site does not. */
export interface KeywordGapEntry extends KeywordIdea {
  /** Where the competitor ranks, 1 being the top. Null when the vendor omits it. */
  competitorPosition: number | null
  competitorUrl?: string
}

export interface KeywordGapResult {
  competitor: string
  keywords: KeywordGapEntry[]
  /**
   * How many rows Search Console removed because this site already appears for them.
   *
   * Null means the subtraction never ran (Google not connected, or no matching property), which
   * is a weaker answer than zero removed and has to read differently.
   */
  subtracted: number | null
  /** Present when something is missing, explaining what and why it matters. */
  note?: string
}

/** One question a site's customers actually ask, and where we learned it. */
/** One attempt the agent made to fix a finding. */
export interface FixAttempt {
  startedAt: string
  finishedAt: string | null
  outcome: 'running' | 'pr_opened' | 'pr_adopted' | 'failed'
  prUrl: string | null
  error: string | null
  /** What became of the PR this attempt opened. Null while open, or when it opened none. */
  prResolution: 'merged' | 'closed' | null
  revertedAt: string | null
  revertPrUrl: string | null
}

/** How often the agent's pull requests were merged, and how often a merge was reverted. */
export interface FixPrRates {
  opened: number
  open: number
  merged: number
  closedUnmerged: number
  reverted: number
  mergeRate: number | null
  revertRate: number | null
}

/** One recorded measurement: a named count or score at a moment. */
export interface OutcomeMetric {
  metric: string
  value: number
  unit: string
}

/** A proposed fix and what became of it. Matches the API's outcomes shape. */
export interface FixOutcome {
  rowId: string
  ruleId: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  status: 'pr_open' | 'merged' | 'verified' | 'rejected'
  prUrl: string | null
  falsification: string
  baseline: { capturedAt: string; metrics: OutcomeMetric[] } | null
  verification: {
    outcome: 'verified' | 'rejected' | 'inconclusive'
    verifiedAt: string
    before: { capturedAt: string; metrics: OutcomeMetric[] }
    after: { capturedAt: string; metrics: OutcomeMetric[] }
    summary: string
  } | null
  note: string | null
  affectedPages: number
}

export interface SiteOutcomes {
  outcomes: FixOutcome[]
  counts: Record<FixOutcome['status'], number>
  rates: FixPrRates
}

/** A site's own details: its name, what it offers, where its customers are, its competitors. */
export interface SiteProfile {
  url: string
  /** Captured from the homepage title when it plainly states the name; otherwise typed. */
  brand: string | null
  offering: string | null
  market: string | null
  competitors: string[]
  /** Sites the owner has said are not about them, left out of their brand mentions. */
  mentionExclusions: string[]
  /** What each competitor is called, by domain. Null: its homepage states none. Absent: not read yet. */
  competitorNames: Record<string, string | null>
}

/** A competitor offered for a person to accept. It has been fetched and it answered. */
export interface CompetitorSuggestion {
  domain: string
  /** Why it was suggested, in a sentence. */
  reason: string
  /** The title of its own homepage, so the choice does not rest on the model's word alone. */
  title: string | null
}

export interface CompetitorSuggestions {
  suggestions: CompetitorSuggestion[]
  /** Candidates that were named and did not answer when fetched. */
  dropped: number
  basedOn: { offering: boolean; market: boolean; homepage: boolean }
}

/** A plan an account can be on. Matches `Plan` in `@seo/core`. */
export interface BillingPlan {
  id: 'free' | 'growth' | 'agency'
  name: string
  /** In the currency's minor unit. Zero is free. */
  priceMinor: number
  currency: string
  /** The monthly cap on paid work this plan grants, or null for the deployment's default. */
  monthlyBudgetMicros: number | null
  summary: string
}

/** Matches the API's billing shape (ADR-0036). */
export interface Billing {
  /** False when no payment rail is configured, in which case every account is on the free plan. */
  configured: boolean
  provider: string | null
  /** Always 'test': this deployment cannot take a real payment. */
  mode: 'test'
  plan: BillingPlan['id']
  plans: BillingPlan[]
}

/** A competitor's AI citations over a span: how many checks named them, out of how many ran. */
export interface CitationWindow {
  cited: number
  checks: number
}

/** One thing that differed between two weekly snapshots of a competitor's public pages. */
export interface CompetitorChange {
  kind: 'title' | 'description' | 'h1' | 'new_url'
  url: string
  before: string | null
  after: string | null
}

/** Everything one snapshot found changed for one competitor, with the citations either side. */
export interface CompetitorChangeBatch {
  competitor: string
  detectedAt: string
  changes: CompetitorChange[]
  citationsBefore: CitationWindow
  citationsAfter: CitationWindow
  /** False until a full window has passed since the change. */
  afterComplete: boolean
}

/** Matches the API's competitor-watch shape (ADR-0034). */
export interface CompetitorWatch {
  competitors: {
    domain: string
    /** Null when the weekly sweep has not reached this competitor yet. */
    lastSnapshotAt: string | null
    pagesRead: number
    /** Why the last snapshot read nothing, when it did not. */
    note: string | null
  }[]
  batches: CompetitorChangeBatch[]
  intervalDays: number
  windowDays: number
}

/** A question the agent drafted for AI-visibility tracking, with why it fits the business. */
export interface SuggestedPrompt {
  prompt: string
  reason: string
}

export interface PromptSuggestions {
  suggestions: SuggestedPrompt[]
  /** Set when the homepage could not be read and the draft leaned on less context. */
  note?: string
}

export interface MinedQuestion {
  question: string
  /**
   * Which source produced it. They are not equivalent: `search-console` means this site is
   * already being shown for the question, `people-also-ask` means Google offers it alongside the
   * subject. Only the first is demand this site receives.
   */
  source: 'search-console' | 'people-also-ask'
  impressions?: number
  position?: number
  /** Other phrasings of the same question, grouped so one gap is one row. */
  variants: string[]
}

export interface MinedQuestions {
  questions: MinedQuestion[]
  /** Present when a source contributed nothing, saying which and why. */
  note?: string
}

/** One place that might publish this client, after its own page has been read. */
export interface ContributorCandidate {
  domain: string
  url: string
  title?: string
  snippet?: string
  /** `inviting` is an opportunity; `selling` was refused for selling placements. */
  verdict: 'inviting' | 'selling' | 'neither'
  /** The phrases that decided the verdict, so a human can disagree with the evidence. */
  matched: string[]
  relevance: number
}

export interface ContributorSearch {
  niche: string
  opportunities: ContributorCandidate[]
  /** Named rather than dropped: a filter nobody can see is a filter nobody can check. */
  refused: ContributorCandidate[]
  queriesRun: number
  note?: string
}

export interface KeywordGapQuery {
  siteId: string
  competitor: string
  country?: string
  language?: string
  limit?: number
}

export interface KeywordIdeasQuery {
  seed: string
  /** ISO country, e.g. 'ke'. Search volume is per-market, so this changes the answer. */
  country?: string
  language?: string
  limit?: number
}
