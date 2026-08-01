import {
  SerpBudgetError,
  type AiOverviewResult,
  type MentionResult,
  type SerpProvider,
  type SerpQueryOptions,
} from './types.js'

/**
 * A SerpProvider that will not spend a tenant's money past its cap.
 *
 * A decorator around the vendor adapter rather than a check inside it, for the reason ADR-0016
 * gives for the seam itself: the vendor is swappable, and a guard living inside SerpApi's adapter
 * would have to be rewritten, correctly, in every adapter that follows. Wrapping means DataForSEO
 * arrives already capped, and it means the adapter stays a pure translation of one vendor's shape.
 *
 * The guard is injected as two functions rather than a database handle, exactly as `@seo/llm`
 * takes its checker and recorder (ADR-0005). That is what keeps this package free of `@seo/db`
 * (STORY-013), and it is what lets the whole thing be tested with no key, no database, and no
 * spend. The worker composes the real implementation from `@seo/budget`.
 */

export interface SerpBudgetHooks {
  /** Called before every paid query. A refusal stops the call; the money is never spent. */
  checkBudget: (tenantId: string) => Promise<{ allowed: boolean; reason?: string }>
  /** Called after a query returns, with what it cost. */
  recordSpend: (
    tenantId: string,
    entry: { provider: string; model: string; micros: number },
  ) => Promise<void>
}

export interface BudgetedSerpOptions extends SerpBudgetHooks {
  /** Whose budget this spends. Every paid call in the product is somebody's. */
  tenantId: string
  /**
   * What one query costs, in millionths of a dollar.
   *
   * A configured constant rather than something read back from the vendor, because the vendor
   * tells you afterwards and the guard has to decide before. It is per-plan (SerpApi's rate falls
   * as the plan grows), so it belongs in configuration next to the key rather than in a table
   * here that would be wrong for most operators.
   */
  costPerQueryMicros: number
}

/**
 * Wrap a provider so every query is checked against the tenant's budget first and recorded after.
 *
 * The order is the whole point (ADR-0017): refuse, then call, then record. Recording first would
 * charge for queries that never happened, and recording only on success would let a vendor error
 * after billing go uncounted.
 */
export function budgeted(provider: SerpProvider, options: BudgetedSerpOptions): SerpProvider {
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    const verdict = await options.checkBudget(options.tenantId)
    if (!verdict.allowed) {
      throw new SerpBudgetError(verdict.reason ?? 'the tenant is over its monthly budget')
    }

    try {
      return await run()
    } finally {
      /**
       * Recorded in a `finally`, so a query that fails after the vendor counted it against our
       * quota still counts against the cap. Erring towards over-recording is the right direction
       * for a cost guard: the failure mode is a tenant reaching its cap slightly early, rather
       * than an unbounded loop of failing, billable calls that the ledger never sees.
       *
       * A failure to record must not mask the original error, so it is caught and logged. The
       * money is already spent by this point; losing the outcome of the call on top would help
       * nobody.
       */
      await options
        .recordSpend(options.tenantId, {
          provider: provider.name,
          model: 'search',
          micros: options.costPerQueryMicros,
        })
        .catch((error: unknown) => {
          console.error('serp: could not record what this query cost:', error)
        })
    }
  }

  return {
    name: provider.name,
    aiOverview: (query: string, queryOptions?: SerpQueryOptions): Promise<AiOverviewResult> =>
      guarded(() => provider.aiOverview(query, queryOptions)),
    mentions: (brand: string, queryOptions?: SerpQueryOptions): Promise<MentionResult> =>
      guarded(() => provider.mentions(brand, queryOptions)),
  }
}
