import type { SerpBudgetHooks } from '../serp/budgeted.js'
import {
  KeywordBudgetError,
  type KeywordGap,
  type KeywordIdea,
  type KeywordOptions,
  type KeywordProvider,
} from './types.js'

/**
 * A KeywordProvider that will not spend a tenant's money past its cap.
 *
 * Same order as every other paid surface in the product (ADR-0017): **refuse, then call, then
 * record in a `finally`**. See `serp/budgeted.ts` for why each of those three is where it is.
 *
 * Explicit rather than a generic proxy for the same reason as the backlink decorator: the returned
 * object literal is typed as `KeywordProvider`, so a method added to the interface and forgotten
 * here fails to compile instead of quietly arriving unguarded.
 */

export interface BudgetedKeywordOptions extends SerpBudgetHooks {
  tenantId: string
  /**
   * The configured worst case for one query, in millionths of a dollar.
   *
   * The vendor bills per request plus per row, so the exact figure is only known after the call
   * and the guard has to decide before it. Erring high is the safe direction for a cost guard.
   */
  costPerQueryMicros: number
}

export function budgetedKeywords(
  provider: KeywordProvider,
  options: BudgetedKeywordOptions,
): KeywordProvider {
  return {
    name: provider.name,

    async ideas(seed: string, keywordOptions?: KeywordOptions): Promise<KeywordIdea[]> {
      return spend(() => provider.ideas(seed, keywordOptions))
    },

    async gap(
      client: string,
      competitor: string,
      keywordOptions?: KeywordOptions,
    ): Promise<KeywordGap> {
      return spend(() => provider.gap(client, competitor, keywordOptions))
    },
  }

  /** Refuse, then call, then record. The order is the decision ADR-0017 exists to hold. */
  async function spend<T>(call: () => Promise<T>): Promise<T> {
    const verdict = await options.checkBudget(options.tenantId, options.costPerQueryMicros)
    if (!verdict.allowed) {
      throw new KeywordBudgetError(verdict.reason ?? 'the tenant is over its monthly budget')
    }

    try {
      return await call()
    } finally {
      await options
        .recordSpend(options.tenantId, {
          provider: provider.name,
          model: 'keywords',
          micros: options.costPerQueryMicros,
          ...(verdict.reservationId ? { reservationId: verdict.reservationId } : {}),
        })
        .catch((error: unknown) => {
          console.error('keywords: could not record what this query cost:', error)
        })
    }
  }
}
