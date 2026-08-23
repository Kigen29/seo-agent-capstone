export { createCruxClient, CruxRateLimitError } from './crux/client.js'
export type { CruxClientOptions } from './crux/client.js'

export { evaluateCoreWebVitals, CORE_WEB_VITALS_CHECKS } from './crux/evaluate.js'

export { THRESHOLDS, bandFor } from './crux/thresholds.js'
export type { Band, MetricId, Threshold } from './crux/thresholds.js'

export type { CruxLookup, CruxMetric, CruxRecord } from './crux/types.js'

export { decryptToken, encryptToken, safeEqual } from './google/crypto.js'
export {
  buildAuthUrl,
  exchangeCode,
  googleOAuthConfigFromEnv,
  refreshAccessToken,
  signState,
  verifyState,
} from './google/oauth.js'
export type { OAuthConfig, TokenResponse } from './google/oauth.js'

export {
  createGscClient,
  defaultWindow,
  GscAuthError,
  GscRateLimitError,
  MAX_ROWS_PER_REQUEST,
} from './gsc/client.js'
export type { GscClientOptions } from './gsc/client.js'
export type {
  GscProperty,
  SearchAnalyticsQuery,
  SearchAnalyticsRow,
  SearchDimension,
} from './gsc/types.js'

export { evaluateQuickWins, QUICK_WIN_CHECKS } from './gsc/quick-wins.js'
export type { QuickWinsInput } from './gsc/quick-wins.js'

export {
  createSiteVerificationClient,
  SiteVerificationAuthError,
  META_TAG_NAME,
} from './siteverification/client.js'
export type { SiteVerificationClientOptions } from './siteverification/client.js'

export { createSerpApiProvider } from './serp/serpapi.js'
export type { SerpApiOptions } from './serp/serpapi.js'
export { budgeted } from './serp/budgeted.js'
export type { BudgetedSerpOptions, SerpBudgetHooks } from './serp/budgeted.js'
export { SerpBudgetError, SerpRequestError } from './serp/types.js'
export type {
  AiOverviewResult,
  MentionResult,
  SerpProvider,
  SerpQueryOptions,
  SerpSource,
} from './serp/types.js'

export { aiOverviewEngine } from './visibility/ai-overview.js'

export { classifyMentions, mentionQuery } from './authority/mentions.js'
export type { MentionFootprint } from './authority/mentions.js'
export { evaluateAuthority, THIN_FOOTPRINT, MIN_UNLINKED_MENTIONS } from './authority/evaluate.js'
export type { AuthorityInput, AuthorityReport } from './authority/evaluate.js'

export { dataForSeoFromEnv, DataForSeoError } from './dataforseo/request.js'
export type { DataForSeoCredentials } from './dataforseo/request.js'

export {
  createDataForSeoBacklinks,
  DEFAULT_LIMIT as DEFAULT_BACKLINK_LIMIT,
} from './backlinks/dataforseo.js'
export { budgetedBacklinks } from './backlinks/budgeted.js'
export type { BudgetedBacklinkOptions } from './backlinks/budgeted.js'
export { BacklinkBudgetError, BacklinkRequestError } from './backlinks/types.js'
export type { BacklinkProvider, ReferringDomain, ReferringDomains } from './backlinks/types.js'

export {
  createDataForSeoKeywords,
  DEFAULT_LIMIT as DEFAULT_KEYWORD_LIMIT,
  MAX_LIMIT as MAX_KEYWORD_LIMIT,
} from './keywords/dataforseo.js'
export { budgetedKeywords } from './keywords/budgeted.js'
export type { BudgetedKeywordOptions } from './keywords/budgeted.js'
export { KeywordBudgetError } from './keywords/types.js'
export type { KeywordIdea, KeywordOptions, KeywordProvider } from './keywords/types.js'

export { checkCitation, sameSite, hostOf } from './visibility/citation.js'
export {
  summarisePrompt,
  shareOfVoice,
  MIN_DAYS,
  MIN_POLLS,
  STABLE_THRESHOLD,
} from './visibility/stability.js'
export { pollEngines, pollEnginesDetailed } from './visibility/poll.js'
export type { PolledAnswer } from './visibility/poll.js'
export { consensusRange, describeConsensus } from './visibility/consensus.js'
export { evaluateVisibility } from './visibility/evaluate.js'
export type { AiEngine, EngineAnswer, PollTarget, CitationCheck } from './visibility/types.js'
export type { Stability, PromptSummary, ShareOfVoice } from './visibility/stability.js'
export type { ConsensusRange } from './visibility/consensus.js'
export type {
  EvaluateVisibilityInput,
  PromptWindow,
  VisibilityReport,
} from './visibility/evaluate.js'
