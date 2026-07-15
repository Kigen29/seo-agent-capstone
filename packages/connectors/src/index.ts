export { createCruxClient, CruxRateLimitError } from './crux/client.js'
export type { CruxClientOptions } from './crux/client.js'

export { evaluateCoreWebVitals, CORE_WEB_VITALS_CHECKS } from './crux/evaluate.js'

export { THRESHOLDS, bandFor } from './crux/thresholds.js'
export type { Band, MetricId, Threshold } from './crux/thresholds.js'

export type { CruxLookup, CruxMetric, CruxRecord } from './crux/types.js'
