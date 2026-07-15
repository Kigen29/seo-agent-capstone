/** A Search Console property, as the API lists it. */
export interface GscProperty {
  /** e.g. 'sc-domain:example.com' or 'https://example.com/'. */
  siteUrl: string
  /** 'siteOwner' | 'siteFullUser' | 'siteRestrictedUser' | 'siteUnverifiedUser'. */
  permissionLevel: string
}

/** One row of Search Analytics: a dimension tuple and its metrics over the queried window. */
export interface SearchAnalyticsRow {
  /** The dimension values, in the order they were requested (e.g. [query] or [page, query]). */
  keys: string[]
  clicks: number
  impressions: number
  /** Click-through rate, 0..1. */
  ctr: number
  /** Average position, 1 is the top. Lower is better. */
  position: number
}

export type SearchDimension = 'query' | 'page' | 'country' | 'device' | 'date' | 'searchAppearance'

export interface SearchAnalyticsQuery {
  startDate: string
  endDate: string
  dimensions: SearchDimension[]
  /** Up to 25,000 per request (GSC's hard cap). Defaults to 1,000. */
  rowLimit?: number
  startRow?: number
}
