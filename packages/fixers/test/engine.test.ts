import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FixerRegistry,
  PAGE_CAP_STOP,
  PageCapExceededError,
  type FileChange,
  type FixContext,
  type Fixer,
  type FixResult,
} from '../src/engine.js'
import { makeFinding } from './fixtures.js'

/** A fixer whose behaviour a test can steer, defaulting to a one-file fix that always applies. */
function fakeFixer(opts: {
  ruleId: string
  canFix?: (finding: ReturnType<typeof makeFinding>) => boolean
  files?: FileChange[]
  result?: FixResult | null
}): Fixer {
  return {
    ruleId: opts.ruleId,
    canFix: opts.canFix ?? (() => true),
    generate: async () =>
      opts.result !== undefined
        ? opts.result
        : {
            files: opts.files ?? [{ path: 'app/layout.tsx', content: '<link rel="canonical" />' }],
            expectedEffect: 'Ranking signals stop being split.',
            rollback: 'Revert the merge commit.',
          },
  }
}

const ctxFor = (finding: ReturnType<typeof makeFinding>): FixContext => ({
  finding,
  framework: 'next',
  read: async () => null,
})

afterEach(() => vi.restoreAllMocks())

describe('FixerRegistry.fixerFor', () => {
  it('selects the fixer registered for the finding’s ruleId', () => {
    const canonical = fakeFixer({ ruleId: 'TECH-006' })
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-002' }), canonical)

    expect(registry.fixerFor(makeFinding({ ruleId: 'TECH-006' }))).toBe(canonical)
  })

  it('returns undefined for a finding no fixer owns', () => {
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-006' }))
    expect(registry.fixerFor(makeFinding({ ruleId: 'TECH-999' }))).toBeUndefined()
  })

  it('returns undefined when the finding is not fixable, whatever its rule', () => {
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-006' }))
    expect(registry.fixerFor(makeFinding({ fixable: false }))).toBeUndefined()
  })

  it('skips a fixer that says it cannot fix this particular finding', () => {
    const registry = new FixerRegistry().register(
      fakeFixer({ ruleId: 'TECH-006', canFix: () => false }),
    )
    expect(registry.fixerFor(makeFinding({ ruleId: 'TECH-006' }))).toBeUndefined()
  })
})

describe('FixerRegistry.generate', () => {
  it('returns the fixer’s result for a finding it can fix', async () => {
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-006' }))
    const result = await registry.generate(ctxFor(makeFinding()))

    expect(result?.files).toHaveLength(1)
    expect(result?.expectedEffect).toBeTruthy()
    expect(result?.rollback).toBeTruthy()
  })

  it('returns null when no fixer applies', async () => {
    const registry = new FixerRegistry()
    expect(await registry.generate(ctxFor(makeFinding()))).toBeNull()
  })

  it('returns null when the fixer produces no changes', async () => {
    const registry = new FixerRegistry().register(
      fakeFixer({ ruleId: 'TECH-006', result: { files: [], expectedEffect: 'x', rollback: 'y' } }),
    )
    expect(await registry.generate(ctxFor(makeFinding()))).toBeNull()
  })

  it('returns null when the fixer, on inspection, declines with null', async () => {
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-006', result: null }))
    expect(await registry.generate(ctxFor(makeFinding()))).toBeNull()
  })

  it('hard-stops past the page cap (rule 7)', async () => {
    const tooMany = Array.from({ length: PAGE_CAP_STOP + 1 }, (_, i) => ({
      path: `page-${i}.html`,
      content: '',
    }))
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-006', files: tooMany }))

    await expect(registry.generate(ctxFor(makeFinding()))).rejects.toThrow(PageCapExceededError)
  })

  it('warns but allows a fix approaching the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const many = Array.from({ length: 35 }, (_, i) => ({ path: `page-${i}.html`, content: '' }))
    const registry = new FixerRegistry().register(fakeFixer({ ruleId: 'TECH-006', files: many }))

    const result = await registry.generate(ctxFor(makeFinding()))
    expect(result?.files).toHaveLength(35)
    expect(warn).toHaveBeenCalledOnce()
  })
})
