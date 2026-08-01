import { asOwner, createDb, spend, tenants, withTenant, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  budgetStatus,
  createBudgetGuard,
  microsToUsd,
  monthStart,
  recordSpend,
  usdToMicros,
} from '../src/index.js'

/**
 * The cost guard, against a real Postgres.
 *
 * A cap is a claim about what the database will refuse, so a mocked database would only test our
 * belief about the sum. The two things worth proving are that spend accumulates across calls, and
 * that one tenant's spending cannot exhaust another's allowance, which is the whole reason the
 * cap is per tenant rather than platform-wide (ADR-0016).
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

describe.skipIf(!shouldRun)('the budget guard', () => {
  let db: Database
  let closeDb: () => Promise<void>
  let tenantId: string
  let otherTenantId: string

  const newTenant = async (name: string, capMicros: number) =>
    asOwner(db, async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ name: `${name}-${Date.now()}`, monthlyBudgetMicros: capMicros })
        .returning({ id: tenants.id })
      return row!.id
    })

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    closeDb = () => created.pool.end()

    tenantId = await newTenant('budget-test', usdToMicros(1))
    otherTenantId = await newTenant('budget-test-other', usdToMicros(1))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await withTenant(db, tenantId, (tx) => tx.delete(spend).where(eq(spend.tenantId, tenantId)))
    await withTenant(db, otherTenantId, (tx) =>
      tx.delete(spend).where(eq(spend.tenantId, otherTenantId)),
    )
  })

  afterAll(async () => {
    if (!db) return
    await asOwner(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantId))
      await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
    })
    await closeDb()
  })

  const llmSpend = (usd: number) => ({
    kind: 'llm',
    provider: 'openai',
    model: 'gpt-4.1',
    micros: usdToMicros(usd),
    inputTokens: 100,
    outputTokens: 50,
  })

  it('allows a tenant that has never spent anything', async () => {
    const status = await budgetStatus(db, tenantId)

    expect(status.spentMicros).toBe(0)
    expect(status.capMicros).toBe(usdToMicros(1))
    expect(status.allowed).toBe(true)
  })

  it('accumulates spend across calls', async () => {
    await recordSpend(db, tenantId, llmSpend(0.2))
    await recordSpend(db, tenantId, llmSpend(0.3))

    const status = await budgetStatus(db, tenantId)
    expect(microsToUsd(status.spentMicros)).toBeCloseTo(0.5)
    expect(status.allowed).toBe(true)
  })

  it('refuses once the cap is reached, and says what was spent', async () => {
    await recordSpend(db, tenantId, llmSpend(1))

    const { checkBudget } = createBudgetGuard(db)
    const verdict = await checkBudget(tenantId)

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('$1.00 of its $1.00 monthly budget')
  })

  it('does not let one tenant spend another tenant allowance', async () => {
    await recordSpend(db, tenantId, llmSpend(1))

    // The whole reason the cap is per tenant. A platform-wide limit would refuse this tenant for
    // somebody else's runaway prompt list, and the tenant refused would be the one who did
    // nothing wrong.
    const other = await budgetStatus(db, otherTenantId)
    expect(other.spentMicros).toBe(0)
    expect(other.allowed).toBe(true)
  })

  it('counts this calendar month only, so a cap actually resets', async () => {
    await recordSpend(db, tenantId, llmSpend(1))

    // Backdate the row to last month. A budget nobody can ever recover from is not a budget.
    const before = new Date(monthStart())
    before.setUTCDate(before.getUTCDate() - 1)
    await withTenant(db, tenantId, (tx) =>
      tx.update(spend).set({ createdAt: before }).where(eq(spend.tenantId, tenantId)),
    )

    const status = await budgetStatus(db, tenantId)
    expect(status.spentMicros).toBe(0)
    expect(status.allowed).toBe(true)
  })

  it('records what a call cost through the LLM recorder seam', async () => {
    const guard = createBudgetGuard(db)

    await guard.recordSpend(tenantId, {
      inputTokens: 1000,
      outputTokens: 500,
      provider: 'openai',
      model: 'gpt-4.1',
      estimatedUsd: 0.25,
    })

    const rows = await withTenant(db, tenantId, (tx) =>
      tx.select().from(spend).where(eq(spend.tenantId, tenantId)),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'llm',
      provider: 'openai',
      model: 'gpt-4.1',
      micros: usdToMicros(0.25),
      inputTokens: 1000,
      outputTokens: 500,
    })
  })

  it('warns rather than silently under-counting when a model is not in the pricing table', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const guard = createBudgetGuard(db)

    // priceOf returns 0 for an unknown model, so this call bills real money and counts as
    // nothing. The only defence is noticing, so the warning is the feature.
    await guard.recordSpend(tenantId, {
      inputTokens: 1000,
      outputTokens: 500,
      provider: 'openai',
      model: 'a-model-nobody-priced',
      estimatedUsd: 0,
    })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not in the pricing table'))
    warn.mockRestore()
  })

  it('is silent about a call that genuinely cost nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const guard = createBudgetGuard(db)

    // Zero cost and zero tokens is a free-tier call, not a pricing gap. Warning here would train
    // an operator to ignore the warning that matters.
    await guard.recordSpend(tenantId, {
      inputTokens: 0,
      outputTokens: 0,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      estimatedUsd: 0,
    })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('fails closed when the ledger cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { execute: () => Promise.reject(new Error('connection lost')) } as never
    const { checkBudget } = createBudgetGuard(broken)

    // A guard that allows the call when it cannot read the ledger is a guard-shaped hole that
    // opens exactly when the database is unhappy, and the cost of being wrong that way is money.
    const verdict = await checkBudget(tenantId)

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('could not be read')
    error.mockRestore()
  })
})
