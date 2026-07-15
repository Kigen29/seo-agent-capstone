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
