import { describe, expect, it } from 'vitest'
import { shareOfVoice, summarisePrompt } from '../src/visibility/stability.js'
import type { CitationCheck, PollTarget } from '../src/visibility/types.js'

const check = (cited: boolean, citedCompetitors: string[] = []): CitationCheck => ({
  engine: 'perplexity',
  prompt: 'best safari company in nairobi',
  cited,
  citedCompetitors,
  basis: 'citations',
})

describe('summarisePrompt', () => {
  it('reports insufficient below three polls, never a verdict from one', () => {
    // The whole point: a single lucky citation is not reportable.
    expect(summarisePrompt([check(true)], 1).stability).toBe('insufficient')
    expect(summarisePrompt([check(true), check(true)], 2).stability).toBe('insufficient')
  })

  it('reports insufficient when three polls all happened on the same day', () => {
    // Three engines polled in one minute is three checks and one observation. The sample size
    // is satisfied and the time floor is not, and the time floor is the one that matters here.
    const summary = summarisePrompt([check(true), check(true), check(true)], 1)
    expect(summary.stability).toBe('insufficient')
    expect(summary.pollsRun).toBe(3)
    expect(summary.daysPolled).toBe(1)
  })

  it('is absent when three-plus polls never cite', () => {
    const summary = summarisePrompt([check(false), check(false), check(false)], 3)
    expect(summary.stability).toBe('absent')
    expect(summary.citedCount).toBe(0)
    expect(summary.citationRate).toBe(0)
  })

  it('is unstable when cited in only one of three (the ~45% case)', () => {
    const summary = summarisePrompt([check(true), check(false), check(false)], 3)
    expect(summary.stability).toBe('unstable')
    expect(summary.citedCount).toBe(1)
    expect(summary.citationRate).toBeCloseTo(1 / 3)
  })

  it('is stable at two of three and at three of three', () => {
    expect(summarisePrompt([check(true), check(true), check(false)], 3).stability).toBe('stable')
    expect(summarisePrompt([check(true), check(true), check(true)], 3).stability).toBe('stable')
  })
})

describe('shareOfVoice', () => {
  const target: PollTarget = {
    domain: 'heartbeestsafaris.com',
    competitors: ['rivalsafaris.com', 'anothertour.co.ke'],
  }

  it('computes the client share against competitor citations', () => {
    const checks = [
      check(true, ['rivalsafaris.com']),
      check(false, ['rivalsafaris.com']),
      check(true, []),
    ]
    const sov = shareOfVoice(checks, target)

    expect(sov.client).toBe(2)
    expect(sov.competitors).toEqual([
      { domain: 'rivalsafaris.com', citations: 2 },
      { domain: 'anothertour.co.ke', citations: 0 },
    ])
    // client 2 of (2 + 2 + 0) = 0.5
    expect(sov.clientShare).toBe(0.5)
  })

  it('is a zero share, not a divide-by-zero, when nobody was cited', () => {
    const sov = shareOfVoice([check(false), check(false)], target)
    expect(sov.clientShare).toBe(0)
  })
})
