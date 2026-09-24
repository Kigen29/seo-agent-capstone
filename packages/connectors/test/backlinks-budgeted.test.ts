import { describe, expect, it, vi } from 'vitest'
import { budgetedBacklinks } from '../src/backlinks/budgeted.js'
import { BacklinkBudgetError, type BacklinkProvider } from '../src/backlinks/types.js'

/**
 * The guard on the second paid vendor, and specifically on its second paid method.
 *
 * The decorator is written by hand rather than as a generic proxy so that a method added to the
 * interface and forgotten here fails to compile (ADR-0021). That catches the method going
 * *missing*; it cannot catch the method being added and wired to the wrong order of operations,
 * which is what these assert: refuse, then call, then record.
 */

const fakeProvider = (overrides: Partial<BacklinkProvider> = {}): BacklinkProvider => ({
  name: 'fake-backlinks',
  referringDomains: async (domain) => ({ target: domain, total: 0, domains: [], limit: 100 }),
  intersection: async (targets, exclude) => ({
    targets: [...targets],
    excluded: exclude,
    total: 0,
    domains: [],
    limit: 50,
  }),
  ...overrides,
})

const hooks = (allowed: boolean, reason?: string) => ({
  checkBudget: vi.fn(async () => (allowed ? { allowed: true } : { allowed: false, reason })),
  recordSpend: vi.fn(async () => undefined),
})

const wrap = (provider: BacklinkProvider, guard: ReturnType<typeof hooks>) =>
  budgetedBacklinks(provider, { ...guard, tenantId: 'tenant-1', costPerQueryMicros: 30_000 })

describe('a budgeted BacklinkProvider', () => {
  it('checks the budget before a gap query and records what it cost after', async () => {
    const guard = hooks(true)
    const intersection = vi.fn(fakeProvider().intersection)

    await wrap(fakeProvider({ intersection }), guard).intersection(['rival.com'], 'client.com')

    expect(guard.checkBudget).toHaveBeenCalledWith('tenant-1', 30_000)
    expect(intersection).toHaveBeenCalledWith(['rival.com'], 'client.com', undefined)
    expect(guard.recordSpend).toHaveBeenCalledWith('tenant-1', {
      provider: 'fake-backlinks',
      model: 'backlinks',
      micros: 30_000,
    })
  })

  it('refuses a gap query over budget without calling the vendor at all', async () => {
    const guard = hooks(false, 'over the monthly cap')
    const intersection = vi.fn(fakeProvider().intersection)

    await expect(
      wrap(fakeProvider({ intersection }), guard).intersection(['rival.com'], 'client.com'),
    ).rejects.toBeInstanceOf(BacklinkBudgetError)

    // Refusing after the call would be an expensive way to enforce a cap.
    expect(intersection).not.toHaveBeenCalled()
    expect(guard.recordSpend).not.toHaveBeenCalled()
  })

  it('still records the spend when the vendor fails mid-query', async () => {
    // The money is gone whether or not the response arrived. Recording only on success would let
    // a tenant spend past the cap by failing repeatedly.
    const guard = hooks(true)
    const intersection = vi.fn(async () => {
      throw new Error('vendor exploded')
    })

    await expect(
      wrap(fakeProvider({ intersection }), guard).intersection(['rival.com'], 'client.com'),
    ).rejects.toThrow('vendor exploded')

    expect(guard.recordSpend).toHaveBeenCalled()
  })

  it('guards referring domains the same way', async () => {
    const guard = hooks(false, 'over the monthly cap')

    await expect(wrap(fakeProvider(), guard).referringDomains('client.com')).rejects.toBeInstanceOf(
      BacklinkBudgetError,
    )
  })
})
