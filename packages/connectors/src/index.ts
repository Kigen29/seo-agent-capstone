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
  MapsUrlError,
  mapsUrlForCid,
  parseMapsUrl,
  resolveMapsUrl,
  reviewUrlForPlaceId,
} from './local/maps-url.js'
export type { BusinessProfile } from './local/maps-url.js'

export {
  classifyGap,
  classifyGapDomain,
  linkGapFinding,
  MIN_GAP_DOMAINS,
  SPAM_SCORE_LIMIT,
} from './authority/link-gap.js'
export type { ClassifiedGap, ClassifiedGapDomain, GapKind } from './authority/link-gap.js'

export { evaluateCannibalisation, CANNIBALISATION_CHECKS } from './gsc/cannibalisation.js'
export type { CannibalisationInput } from './gsc/cannibalisation.js'

export { evaluateQuestionGaps, QUESTION_GAP_CHECKS } from './gsc/questions.js'

export { findContributors } from './authority/contributors.js'
export type {
  ContributorCandidate,
  ContributorSearch,
  FindContributorsOptions,
} from './authority/contributors.js'
export { classifyContributorPage, contributorQueries } from './authority/link-sellers.js'
export type { ContributorCheck, ContributorVerdict } from './authority/link-sellers.js'

export { assertFetchable, publicFetch, UnsafeUrlError } from './http/public-fetch.js'
export type { PublicFetchOptions, PublicFetchResult } from './http/public-fetch.js'

export { DEFAULT_QUESTION_LIMIT, mineQuestions } from './questions/mine.js'
export type { MinedQuestion, MineQuestionsInput, QuestionSource } from './questions/mine.js'
export type { QuestionGapInput, PageSummary } from './gsc/questions.js'

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
  RelatedQuestionsResult,
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
export type {
  BacklinkProvider,
  LinkGap,
  LinkGapDomain,
  ReferringDomain,
  ReferringDomains,
} from './backlinks/types.js'

export {
  createDataForSeoKeywords,
  DEFAULT_GAP_LIMIT,
  DEFAULT_LIMIT as DEFAULT_KEYWORD_LIMIT,
  MAX_LIMIT as MAX_KEYWORD_LIMIT,
  subtractKnownQueries,
} from './keywords/dataforseo.js'
export { budgetedKeywords } from './keywords/budgeted.js'
export type { BudgetedKeywordOptions } from './keywords/budgeted.js'
export { KeywordBudgetError } from './keywords/types.js'
export type {
  KeywordGap,
  KeywordGapEntry,
  KeywordIdea,
  KeywordOptions,
  KeywordProvider,
} from './keywords/types.js'

export { createGitHubIdentity } from './identity/github.js'
export { createGoogleIdentity } from './identity/google.js'
export {
  newNonce,
  readCookie,
  safeNext,
  signSigninState,
  verifySigninState,
  SIGNIN_NONCE_COOKIE,
} from './identity/state.js'
export type { SigninState } from './identity/state.js'
export type { IdentityProvider, IdentityProviderConfig, SocialIdentity } from './identity/types.js'

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

export { verifyGitHubInstallationAccess } from './identity/github-installation.js'
export type { InstallationAccessOptions } from './identity/github-installation.js'
