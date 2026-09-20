/**
 * Keyword research, behind its own interface.
 *
 * Separate from `SerpProvider` for the same reason `BacklinkProvider` is (ADR-0021): SerpApi does
 * not sell search-volume data, and an interface that forced it to would be describing a vendor
 * that does not exist.
 *
 * Note what this interface deliberately does not do. It returns what a keyword *is* (volume,
 * competition, cost) and never what a client *ranks* for. Rank tracking is a standing daily spend
 * per keyword and is a separate decision from research, which is a question asked occasionally
 * while writing.
 */

/** One keyword, as the vendor measures it. */
export interface KeywordIdea {
  keyword: string
  /** Average monthly searches, most recent month the vendor has. Null when it does not report one. */
  searchVolume: number | null
  /**
   * Paid competition, 0 to 1. This is an **advertising** metric, not organic difficulty.
   *
   * Named precisely because the industry routinely renders it as "keyword difficulty" and lets a
   * reader believe it describes how hard the keyword is to rank for organically. It does not: it
   * describes how many advertisers bid on it. Presenting it as organic difficulty would be the
   * kind of quiet mislabelling this product exists to avoid.
   */
  competition: number | null
  /** Average cost per click in the account's currency, when the vendor reports one. */
  cpc: number | null
}

export interface KeywordOptions {
  /** Where to ask from, e.g. 'ke'. Search volume is per-market and a default would measure the wrong one. */
  country?: string
  language?: string
  /** How many ideas to return. Bounded by the caller, because every row is billed. */
  limit?: number
}

/** A keyword a competitor ranks for, with where they rank. */
export interface KeywordGapEntry extends KeywordIdea {
  /** The competitor's absolute position, 1 being the top. Null when the vendor omits it. */
  competitorPosition: number | null
  /** The competitor page that ranks for it. */
  competitorUrl?: string
}

export interface KeywordGap {
  /** The competitor whose rankings were read. */
  competitor: string
  /** The client the competitor was compared against. */
  client: string
  /** The rows the vendor returned, ordered by search volume. */
  keywords: KeywordGapEntry[]
  /** The row limit this result was fetched with, so a caller can qualify what it derives. */
  limit: number
}

export interface KeywordProvider {
  /** A stable identifier for the spend ledger, e.g. 'dataforseo'. */
  readonly name: string

  /** Keyword ideas related to a seed term, with their volumes. */
  ideas(seed: string, options?: KeywordOptions): Promise<KeywordIdea[]>

  /**
   * Keywords a competitor ranks for and the client does not, as the vendor sees it.
   *
   * "As the vendor sees it" is the whole caveat, and it is why the result is not shown raw. A
   * third-party index is weakest exactly where our clients live: a small site in a small market is
   * routinely absent from it, so the vendor reports a gap for every term the client already ranks
   * for. The Search Console subtraction that fixes it happens above this seam, because a keyword
   * vendor has no business knowing about a tenant's OAuth grant.
   */
  gap(client: string, competitor: string, options?: KeywordOptions): Promise<KeywordGap>
}

/** A paid query was refused before it was made, because the tenant is out of budget. */
export class KeywordBudgetError extends Error {
  constructor(reason: string) {
    super(`Keyword query refused: ${reason}`)
    this.name = 'KeywordBudgetError'
  }
}
