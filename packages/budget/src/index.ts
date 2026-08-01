import { spend, tenants, withTenant, type Database } from '@seo/db'
import type { BudgetChecker, LlmUsage, SpendRecorder } from '@seo/llm'
import { and, eq, gte, sql } from 'drizzle-orm'

/**
 * The cost guard: what a tenant may spend, checked before the money is spent.
 *
 * ADR-0016 names uncontrolled cost as the primary operational risk of a product that makes paid
 * API calls, and the AI-visibility poll turned that from a risk into a certainty: it spends every
 * day, per prompt, per site, indefinitely, with nobody watching. Until now the guard was a stub
 * that returned `allowed: true`, which is a comment describing an intention rather than a control.
 *
 * Two properties matter, and both are about *where* the check sits rather than how it computes:
 *
 *   1. **Before the call, not reconciled after.** A guard that notices afterwards is a report, not
 *      a cap. Spending stops at the moment of asking, so the worst case for a tenant who
 *      misconfigures a huge prompt list is a dark axis and not a bill.
 *   2. **Keyed on the tenant.** A platform-wide limit is not a cap for anybody: the first tenant
 *      to run away spends everyone else's allowance, and the tenants who get refused are the ones
 *      who did nothing wrong.
 */

/** Millionths of a dollar. Money is an integer here; see the tenants table for why. */
export const MICROS_PER_USD = 1_000_000

export interface BudgetStatus {
  /** What this tenant may spend this calendar month, in micro-dollars. */
  capMicros: number
  /** What it has spent so far this month. */
  spentMicros: number
  /** Whether another paid call is allowed. */
  allowed: boolean
}

/**
 * The first instant of the current calendar month, in UTC.
 *
 * A calendar month rather than a rolling window, because a budget is a thing a human reasons
 * about, and "you have $2 left until the 1st" is a sentence somebody can act on in a way that
 * "you have $2 left in a window that ends at an hour depending on when you spent" is not. It also
 * matches how every vendor behind it bills.
 */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Convert a dollar amount to micro-dollars, rounded to the nearest micro. */
export const usdToMicros = (usd: number): number => Math.round(usd * MICROS_PER_USD)

/** For display. Not for arithmetic: do the sums in micros and convert once at the end. */
export const microsToUsd = (micros: number): number => micros / MICROS_PER_USD

/** What a tenant has spent this month, and whether it may spend again. */
export async function budgetStatus(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  return withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ capMicros: tenants.monthlyBudgetMicros })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)

    const [total] = await tx
      .select({
        // COALESCE, because SUM over no rows is NULL, and a tenant who has never spent anything
        // is the single most common case this will ever be asked about.
        spentMicros: sql<number>`coalesce(sum(${spend.micros}), 0)::bigint`,
      })
      .from(spend)
      .where(and(eq(spend.tenantId, tenantId), gte(spend.createdAt, monthStart(now))))

    const capMicros = tenant?.capMicros ?? 0
    const spentMicros = Number(total?.spentMicros ?? 0)

    return { capMicros, spentMicros, allowed: spentMicros < capMicros }
  })
}

/**
 * Record what a call cost. Never silently swallows a failure.
 *
 * A lost write here is worse than a noisy one: the money has already been spent, and a ledger
 * that quietly forgets a row makes the cap too generous by exactly that amount, permanently. So a
 * failure is logged loudly and rethrown, and the caller decides. It is deliberately not wrapped
 * in a try/catch that shrugs.
 */
export async function recordSpend(
  db: Database,
  tenantId: string,
  entry: {
    kind: string
    provider: string
    model: string
    micros: number
    inputTokens?: number
    outputTokens?: number
  },
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx.insert(spend).values({
      tenantId,
      kind: entry.kind,
      provider: entry.provider,
      model: entry.model,
      micros: entry.micros,
      inputTokens: entry.inputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
    }),
  )
}

/**
 * The guard, in the shape `@seo/llm` already asks for.
 *
 * The LLM package takes its recorder and its checker as constructor arguments and knows nothing
 * about a database, which is what lets it stay provider-agnostic and unit-testable. This is the
 * implementation that goes in the hole, and the same `recordSpend` sits under the SERP provider
 * when that lands, so both paid dependencies share one cap rather than having one each.
 */
export function createBudgetGuard(db: Database): {
  checkBudget: BudgetChecker
  recordSpend: SpendRecorder
} {
  return {
    /**
     * Fails closed. A guard that allows the call when it cannot read the ledger is not a guard,
     * it is a guard-shaped hole that opens exactly when the database is unhappy. The cost of
     * being wrong in that direction is real money; the cost of being wrong the other way is a
     * job that retries.
     */
    checkBudget: async (tenantId) => {
      let status: BudgetStatus
      try {
        status = await budgetStatus(db, tenantId)
      } catch (error) {
        console.error('budget: could not read the ledger, refusing the call to be safe:', error)
        return { allowed: false, reason: 'the spend ledger could not be read' }
      }

      if (status.allowed) return { allowed: true }

      return {
        allowed: false,
        reason:
          `this tenant has spent $${microsToUsd(status.spentMicros).toFixed(2)} of its ` +
          `$${microsToUsd(status.capMicros).toFixed(2)} monthly budget. Paid work is paused ` +
          'until the 1st, or until the cap is raised.',
      }
    },

    recordSpend: async (tenantId, usage: LlmUsage) => {
      const micros = usdToMicros(usage.estimatedUsd)

      /**
       * An unpriced model bills real money and records zero, so it is invisible to the cap. That
       * is a genuine hole rather than a rounding detail, and the only defence is noticing: the
       * pricing table is maintained by hand (ADR-0005), and this is the line that tells us it has
       * fallen behind a model somebody is actually using.
       */
      if (micros === 0 && usage.inputTokens + usage.outputTokens > 0) {
        console.warn(
          `budget: ${usage.provider}:${usage.model} is not in the pricing table, so this call ` +
            'is recorded as costing nothing and does not count against the cap. Add it to ' +
            'packages/llm/src/pricing.ts.',
        )
      }

      await recordSpend(db, tenantId, {
        kind: 'llm',
        provider: usage.provider,
        model: usage.model,
        micros,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
    },
  }
}
