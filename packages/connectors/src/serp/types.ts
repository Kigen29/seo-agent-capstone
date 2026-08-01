/**
 * Third-party SERP and AI-Overview data, behind one interface.
 *
 * This is the Strategy seam ADR-0016 designed and the architecture patterns table has named since
 * Sprint 1. Two axes need data no crawl can produce: AI visibility needs what Google's AI Overview
 * says and which sources it cited, and authority needs where the web mentions a brand. Both are
 * sold per query by vendors (SerpApi, DataForSEO) who are interchangeable in principle and utterly
 * different in response shape.
 *
 * Keeping them behind this interface buys two things. The measurement code stays vendor-blind, so
 * `checkCitation` and the authority scorer are tested against fakes with no key and no spend. And
 * this is the **only paid surface in the product**, so it is the one place a budget guard has to
 * sit, rather than a concern sprinkled through every call site.
 */

/** One source a SERP or AI answer pointed at. */
export interface SerpSource {
  url: string
  title?: string
  snippet?: string
}

/** What an AI Overview said for a query, and what it cited. */
export interface AiOverviewResult {
  query: string
  /** The overview text, flattened. Empty when Google showed no AI Overview for this query. */
  text: string
  sources: SerpSource[]
  /**
   * Whether Google actually showed an AI Overview. False is a real, common answer and not a
   * failure: plenty of queries have no overview at all, and treating that as an error would turn
   * "Google chose not to answer this" into "our poll broke".
   */
  present: boolean
}

/** One place the web mentions a brand. */
export interface MentionResult {
  query: string
  sources: SerpSource[]
  /** Google's own estimate of total results, when it gives one. Indicative, never exact. */
  estimatedTotal?: number
}

/**
 * A vendor of SERP and AI-Overview data.
 *
 * Every method here costs money per call. That is why the interface is small: each method is a
 * paid query, and adding one is a decision about spending, not just about code.
 */
export interface SerpProvider {
  /** A stable identifier for the ledger and for the poll's engine name, e.g. 'serpapi'. */
  readonly name: string

  /** What Google's AI Overview says for a query, and which sources it cites. */
  aiOverview(query: string, options?: SerpQueryOptions): Promise<AiOverviewResult>

  /** Where the web mentions a brand. Used by the authority axis, which leads with mentions. */
  mentions(brand: string, options?: SerpQueryOptions): Promise<MentionResult>
}

export interface SerpQueryOptions {
  /**
   * Where to ask from, e.g. 'ke' for Kenya. AI answers are heavily geography-dependent, and the
   * research names geographic scope as the strongest predictor of a stable citation, so asking
   * from the wrong country measures somebody else's market.
   */
  country?: string
  /** Interface language, e.g. 'en'. */
  language?: string
}

/** A paid query was refused before it was made, because the tenant is out of budget. */
export class SerpBudgetError extends Error {
  constructor(reason: string) {
    super(`SERP query refused: ${reason}`)
    this.name = 'SerpBudgetError'
  }
}

/** The vendor said no. Kept distinct so a caller can tell "broken" from "out of money". */
export class SerpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SerpRequestError'
  }
}
