import { describe, expect, it } from 'vitest'
import { citationSentence, COINCIDENCE_NOTE } from './citation-sentence'

describe('citationSentence', () => {
  it('states both counts with their samples', () => {
    expect(citationSentence({ cited: 1, checks: 12 }, { cited: 5, checks: 14 }, 7, true)).toBe(
      'Cited in 1 of 12 checks in the 7 days before, and cited in 5 of 14 checks in the 7 days after.',
    )
  })

  it('marks a window that has not finished', () => {
    expect(citationSentence({ cited: 0, checks: 6 }, { cited: 1, checks: 2 }, 7, false)).toMatch(
      /in the 7 days after so far\.$/,
    )
  })

  it('says no checks ran, never "0 of 0", which would read as not cited', () => {
    const sentence = citationSentence({ cited: 0, checks: 0 }, { cited: 2, checks: 8 }, 7, true)

    expect(sentence).toBe(
      'No checks ran in the 7 days before, and cited in 2 of 8 checks in the 7 days after.',
    )
    expect(sentence).not.toContain('0 of 0')
  })

  it('says there is nothing to compare when no checks ran at all', () => {
    expect(citationSentence({ cited: 0, checks: 0 }, { cited: 0, checks: 0 }, 7, true)).toMatch(
      /nothing to set beside it/,
    )
  })

  /**
   * The falsification condition, as a test. However large the jump, the sentence reports an order
   * of events and no mechanism, and it computes no change figure for a reader to quote.
   */
  it('never claims a cause, even for the most flattering numbers', () => {
    const sentence = citationSentence({ cited: 0, checks: 20 }, { cited: 20, checks: 20 }, 7, true)

    expect(sentence).not.toMatch(/caus|because|led to|result|thanks to|drove|lift|gain|increase|%/i)
  })

  it('has a standing note that names coincidence and denies cause', () => {
    expect(COINCIDENCE_NOTE).toMatch(/coincidence/)
    expect(COINCIDENCE_NOTE).toMatch(/not evidence of a cause/)
  })
})
