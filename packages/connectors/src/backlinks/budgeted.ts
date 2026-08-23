import { BacklinkBudgetError, type BacklinkProvider, type ReferringDomains } from './types.js'
import type { SerpBudgetHooks } from '../serp/budgeted.js'

/**
 * A BacklinkProvider that will not spend a tenant's money past its cap.
 *
 * The same decorator shape as `budgeted()` in `serp/budgeted.ts`, and the same order, which is the
 * whole point of ADR-0017: **refuse, then call, then record**. Recording first would charge for
 * queries that never happened; recording only on success would let a vendor error after billing go
 * uncounted.
 *
 * A separate function rather than one generic wrapper over both interfaces. A `Proxy` that guarded
 * any method of any provider would be shorter and would give up the property that makes this safe:
 * because the decorator returns an object literal typed as `BacklinkProvider`, a method added to
 * the interface and forgotten here **fails to compile**, rather than silently arriving unguarded.
 * For the only paid surface in the product, a compile error is worth more than the duplication.
 *
 * The hooks are shared with the SERP decorator because they describe the ledger, not the vendor:
 * both spend the same tenant's money into the same table.
 */

export interface BudgetedBacklinkOptions extends SerpBudgetHooks {
  tenantId: string
  /**
   * What one query costs, in millionths of a dollar.
   *
   * DataForSEO charges per request plus per row, so the true cost depends on the limit. This is
   * the configured worst case rather than a computed exact figure: the guard has to decide before
   * the call, and the row count is only known after it. Erring high is the safe direction.
   */
  costPerQueryMicros: number
}

export function budgetedBacklinks(
  provider: BacklinkProvider,
  options: BudgetedBacklinkOptions,
): BacklinkProvider {
  return {
    name: provider.name,

    async referringDomains(domain: string, limit?: number): Promise<ReferringDomains> {
      const verdict = await options.checkBudget(options.tenantId)
      if (!verdict.allowed) {
        throw new BacklinkBudgetError(verdict.reason ?? 'the tenant is over its monthly budget')
      }

      try {
        return await provider.referringDomains(domain, limit)
      } finally {
        // In a `finally`, so a query that fails after the vendor counted it still counts against
        // the cap. A failure to record must not mask the original error: the money is already
        // spent, and losing the outcome of the call on top would help nobody.
        await options
          .recordSpend(options.tenantId, {
            provider: provider.name,
            model: 'backlinks',
            micros: options.costPerQueryMicros,
          })
          .catch((error: unknown) => {
            console.error('backlinks: could not record what this query cost:', error)
          })
      }
    },
  }
}
