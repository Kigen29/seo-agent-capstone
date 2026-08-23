/**
 * A backlink index, behind its own interface.
 *
 * Deliberately *not* a third method on `SerpProvider`, and the reason is stronger than tidiness.
 * SerpApi does not sell backlink data at all. Adding `referringDomains` to `SerpProvider` would
 * force `serpapi.ts` to implement a method it cannot honour, and the only options there are to
 * throw (turning a vendor's product boundary into a runtime error) or to return an empty result
 * (a lie that reads as "this site has no backlinks"). Every SERP-only vendor after it would
 * inherit the same dead method.
 *
 * So a vendor's product lines get their own seams. DataForSEO implements both interfaces because
 * DataForSEO sells both; SerpApi implements one because it sells one. That is the shape of the
 * market, and the code says so (ADR-0021).
 *
 * This is a paid surface, so like `SerpProvider` it is small on purpose: every method is money.
 */

/** One domain that links to the target. */
export interface ReferringDomain {
  /** The linking host, normalised and lowercased. */
  domain: string
  /** How many links from it. Indicative of relationship depth, not of quality. */
  backlinks?: number
  /** The vendor's own authority score for the domain, 0-1000 for DataForSEO. Vendor-specific. */
  rank?: number
  /** True when every link from this domain carries rel=nofollow. */
  nofollow?: boolean
}

/**
 * Referring domains for a target.
 *
 * `total` and `domains` answer different questions and must not be conflated. `total` is how many
 * domains link to the target, full stop. `domains` is the slice we paid to enumerate, ordered by
 * the vendor's rank, and it is capped by the limit we asked for. A site with 5,000 referring
 * domains has `total: 5000` and a `domains` array of whatever we requested.
 *
 * Anything computed from `domains` is therefore a statement about the top slice, not about the
 * whole index, and every finding built on it has to say so. That is why `limit` travels with the
 * result rather than being left at the call site.
 */
export interface ReferringDomains {
  target: string
  /** Distinct domains linking to the target, as the vendor counts them. */
  total: number
  /** The slice enumerated, highest rank first. Never longer than `limit`. */
  domains: ReferringDomain[]
  /** The row limit this result was fetched with, so a caller can qualify what it derives. */
  limit: number
}

export interface BacklinkProvider {
  /** A stable identifier for the spend ledger, e.g. 'dataforseo'. */
  readonly name: string

  /**
   * Which domains link to this target, and how many there are in total.
   *
   * One call rather than a separate summary and list, because the vendor charges per request and
   * the two facts we need come back together.
   */
  referringDomains(domain: string, limit?: number): Promise<ReferringDomains>
}

/** A paid query was refused before it was made, because the tenant is out of budget. */
export class BacklinkBudgetError extends Error {
  constructor(reason: string) {
    super(`Backlink query refused: ${reason}`)
    this.name = 'BacklinkBudgetError'
  }
}

/** The vendor said no. Kept distinct so a caller can tell "broken" from "out of money". */
export class BacklinkRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BacklinkRequestError'
  }
}
