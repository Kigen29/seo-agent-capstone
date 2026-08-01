import { describe, expect, it, vi } from 'vitest'
import { budgeted } from '../src/serp/budgeted.js'
import { SerpBudgetError, type SerpProvider } from '../src/serp/types.js'
import { aiOverviewEngine } from '../src/visibility/ai-overview.js'

const fakeProvider = (overrides: Partial<SerpProvider> = {}): SerpProvider => ({
  name: 'fake-serp',
  aiOverview: async (query) => ({
    query,
    text: 'An answer.',
    sources: [{ url: 'https://example.com/a' }],
    present: true,
  }),
  mentions: async (query) => ({ query, sources: [] }),
  ...overrides,
})

const hooks = (allowed: boolean, reason?: string) => ({
  checkBudget: vi.fn(async () => (allowed ? { allowed: true } : { allowed: false, reason })),
  recordSpend: vi.fn(async () => undefined),
})

describe('a budgeted SerpProvider', () => {
  it('checks the budget before it spends, and records what it cost after', async () => {
    const guard = hooks(true)
    const aiOverview = vi.fn(async (query: string) => ({
      query,
      text: 'x',
      sources: [],
      present: true,
    }))

    await budgeted(fakeProvider({ aiOverview }), {
      ...guard,
      tenantId: 'tenant-1',
      costPerQueryMicros: 15_000,
    }).aiOverview('q')

    expect(guard.checkBudget).toHaveBeenCalledWith('tenant-1')
    expect(aiOverview).toHaveBeenCalled()
    expect(guard.recordSpend).toHaveBeenCalledWith('tenant-1', {
      provider: 'fake-serp',
      model: 'search',
      micros: 15_000,
    })
  })

  it('refuses over budget without calling the vendor at all', async () => {
    const guard = hooks(false, 'spent $5.00 of its $5.00 monthly budget')
    const aiOverview = vi.fn()

    const provider = budgeted(fakeProvider({ aiOverview: aiOverview as never }), {
      ...guard,
      tenantId: 'tenant-1',
      costPerQueryMicros: 15_000,
    })

    await expect(provider.aiOverview('q')).rejects.toThrow(SerpBudgetError)

    // The whole point of checking before rather than reconciling after: the money is not spent.
    expect(aiOverview).not.toHaveBeenCalled()
    expect(guard.recordSpend).not.toHaveBeenCalled()
  })

  it('records a query that failed after the vendor had already counted it', async () => {
    const guard = hooks(true)
    const provider = budgeted(
      fakeProvider({
        aiOverview: async () => {
          throw new Error('gateway timeout')
        },
      }),
      { ...guard, tenantId: 'tenant-1', costPerQueryMicros: 15_000 },
    )

    await expect(provider.aiOverview('q')).rejects.toThrow('gateway timeout')

    // Erring towards over-recording is the right direction for a cost guard. The failure mode is
    // reaching the cap slightly early, rather than an unbounded loop of failing billable calls
    // that the ledger never sees.
    expect(guard.recordSpend).toHaveBeenCalled()
  })

  it('does not let a failed ledger write mask what the call actually did', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const guard = {
      checkBudget: vi.fn(async () => ({ allowed: true })),
      recordSpend: vi.fn(async () => {
        throw new Error('ledger unavailable')
      }),
    }

    const result = await budgeted(fakeProvider(), {
      ...guard,
      tenantId: 'tenant-1',
      costPerQueryMicros: 15_000,
    }).aiOverview('q')

    // The money is already spent by this point; losing the answer on top would help nobody.
    expect(result.text).toBe('An answer.')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('guards mentions on the same budget as the overview, not a separate one', async () => {
    const guard = hooks(false, 'over budget')
    const provider = budgeted(fakeProvider(), {
      ...guard,
      tenantId: 'tenant-1',
      costPerQueryMicros: 15_000,
    })

    // Two budgets, one per axis, would let a tenant spend twice what either one allows.
    await expect(provider.mentions('brand')).rejects.toThrow(SerpBudgetError)
  })
})

describe('AI Overviews as a pollable engine', () => {
  it('hands the poll the overview text and its cited sources', async () => {
    const answer = await aiOverviewEngine(fakeProvider()).ask('how much does a safari cost')

    expect(answer).toEqual({
      engine: 'ai_overview',
      prompt: 'how much does a safari cost',
      answer: 'An answer.',
      citations: ['https://example.com/a'],
    })
  })

  it('records an absent overview as an uncited observation, not a dropped one', async () => {
    const answer = await aiOverviewEngine(
      fakeProvider({
        aiOverview: async (query) => ({ query, text: '', sources: [], present: false }),
      }),
    ).ask('a niche query')

    // A hole in a three-day window is expensive. "Nobody was cited" is the truth here, and it is
    // exactly what an empty answer with no sources records.
    expect(answer.answer).toBe('')
    expect(answer.citations).toEqual([])
  })

  it('is named for the engine, not the vendor', async () => {
    // The name is stored on every check row and is half of the one-poll-per-engine-per-day key.
    // Renaming it when the vendor changes would fork one measurement window into two.
    expect(aiOverviewEngine(fakeProvider()).name).toBe('ai_overview')
  })
})
