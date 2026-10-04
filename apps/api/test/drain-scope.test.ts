import { describe, expect, it, vi } from 'vitest'
import { drainScope } from '../../worker/src/drain-scope.js'

describe('manual worker scope', () => {
  it('does not invoke unrelated paid work during a verification-only run', async () => {
    const scope = drainScope('verify-fix')
    const paidPoll = vi.fn(async () => ({ completed: 1, failed: 0 }))
    expect(await scope.run('poll-ai', paidPoll)).toEqual({ completed: 0, failed: 0 })
    expect(paidPoll).not.toHaveBeenCalled()
    const verification = vi.fn(async () => ({ completed: 2, failed: 1 }))
    expect(await scope.run('verify-fix', verification)).toEqual({ completed: 2, failed: 1 })
    expect(verification).toHaveBeenCalledOnce()
  })
  it('preserves the scheduled all-queues default and the legacy crawl alias', () => {
    expect(drainScope().includes('poll-ai')).toBe(true)
    expect(drainScope().includes('audit')).toBe(true)
    expect(drainScope('crawl').includes('audit')).toBe(true)
    expect(drainScope('crawl').includes('fix')).toBe(false)
  })
  it('rejects unknown queues instead of silently running all work', () => {
    expect(() => drainScope('typo')).toThrow('Unknown worker queue')
  })
})
