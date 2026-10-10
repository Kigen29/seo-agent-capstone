import { createBudgetGuard, recordSpend } from '@seo/budget'
import {
  type BacklinkProvider,
  budgeted,
  budgetedBacklinks,
  createDataForSeoBacklinks,
  createSerpApiProvider,
  dataForSeoFromEnv,
  DEFAULT_SERP_COST_PER_QUERY_USD,
  googleOAuthConfigFromEnv,
  type OAuthConfig,
  type SerpProvider,
} from '@seo/connectors'
import type { Database } from '@seo/db'

/** The paid data sources an audit may use, built from the environment and wrapped in the budget guard. */

/** The env OAuth config, or undefined when Google is not configured. Never throws. */
export function googleOAuthConfig(): OAuthConfig | undefined {
  try {
    return googleOAuthConfigFromEnv()
  } catch {
    return undefined
  }
}

/**
 * A budget-guarded SERP provider from the environment, or undefined when no key is configured.
 *
 * Built here rather than taken as a required dependency so the CLI and the worker both get the
 * paid axes without either of them having to know how a provider is assembled. Undefined is the
 * normal case: this is the only paid dependency in the product and it is off by default, which
 * leaves the authority axis honestly unmeasured rather than silently spending (ADR-0016).
 */
export function serpFromEnv(db: Database, tenantId: string): SerpProvider | undefined {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) return undefined

  const guard = createBudgetGuard(db)
  const usd = Number(process.env.SERP_COST_PER_QUERY_USD)

  return budgeted(
    createSerpApiProvider({
      apiKey,
      ...(process.env.SERP_COUNTRY ? { country: process.env.SERP_COUNTRY } : {}),
    }),
    {
      tenantId,
      checkBudget: guard.checkBudget,
      recordSpend: (id, entry) =>
        recordSpend(db, id, {
          kind: 'serp',
          provider: entry.provider,
          model: entry.model,
          micros: entry.micros,
          reservationId: entry.reservationId,
        }),
      // Errs high when unset, which is the safe direction for a cost guard.
      costPerQueryMicros: Math.round(
        (Number.isFinite(usd) && usd > 0 ? usd : DEFAULT_SERP_COST_PER_QUERY_USD) * 1_000_000,
      ),
    },
  )
}

/**
 * A budget-guarded backlink index from the environment, or undefined when none is configured.
 *
 * The second paid dependency, and off by default like the first. Absent, the authority axis
 * behaves exactly as it did before it existed: mentions lead, referring domains are reported as
 * unmeasured rather than as a zero (ADR-0018, ADR-0021).
 */
export function backlinksFromEnv(db: Database, tenantId: string): BacklinkProvider | undefined {
  const credentials = dataForSeoFromEnv()
  if (!credentials) return undefined

  const guard = createBudgetGuard(db)
  const usd = Number(process.env.BACKLINK_COST_PER_QUERY_USD)

  return budgetedBacklinks(createDataForSeoBacklinks(credentials), {
    tenantId,
    checkBudget: guard.checkBudget,
    recordSpend: (id, entry) =>
      recordSpend(db, id, {
        kind: 'serp',
        provider: entry.provider,
        model: entry.model,
        micros: entry.micros,
        reservationId: entry.reservationId,
      }),
    // The vendor's published rate for a live referring-domains request at the default row limit,
    // rounded up. Errs high when unset, which is the safe direction for a cost guard.
    costPerQueryMicros: Math.round((Number.isFinite(usd) && usd > 0 ? usd : 0.03) * 1_000_000),
  })
}
