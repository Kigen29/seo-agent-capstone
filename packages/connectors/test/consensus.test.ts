import { describe, expect, it } from 'vitest'
import { consensusRange, describeConsensus } from '../src/visibility/consensus.js'

describe('consensusRange', () => {
  it('is null when no answer names a currency figure', () => {
    expect(consensusRange(['Prices vary by season.', 'It depends on the operator.'])).toBeNull()
  })

  it('is null from a single answer, because one answer is not a consensus', () => {
    expect(consensusRange(['Expect $2,000 to $4,000 per person.'])).toBeNull()
  })

  it('reports the median low and median high across answers', () => {
    const range = consensusRange([
      'A mid-range safari runs $2,000 to $4,000 per person.',
      'Budget on roughly $2,500 to $5,000.',
      'Most operators quote $3,000 to $6,000.',
    ])

    // Lows 2000, 2500, 3000 -> 2500. Highs 4000, 5000, 6000 -> 5000.
    expect(range).toEqual({ currency: 'USD', low: 2500, high: 5000, answers: 3 })
  })

  it('lets an outlier be outvoted rather than define the range', () => {
    const range = consensusRange([
      'Park fees are about $70 per day.',
      'A safari costs $3,000 to $5,000.',
      'Expect $3,500 to $5,500 per person.',
    ])

    // The outright minimum would be 70. The median of the lows is 3000, which is a number the
    // answers actually agree on.
    expect(range?.low).toBe(3000)
    expect(range?.high).toBe(5000)
  })

  it('reads thousands shorthand and comma separators', () => {
    const range = consensusRange(['Around $2k to $4k.', 'Usually $2,500 to $4,500.'])
    expect(range).toEqual({ currency: 'USD', low: 2000, high: 4500, answers: 2 })
  })

  it('reads a currency code written after the figure', () => {
    const range = consensusRange(['About 250,000 KES.', 'Roughly 300,000 KES all in.'])
    expect(range).toEqual({ currency: 'KES', low: 250_000, high: 300_000, answers: 2 })
  })

  it('keeps a disagreement visible instead of averaging it into a figure nobody stated', () => {
    // Two flat quotes. The midpoint would be $3,500, which neither answer said.
    const range = consensusRange(['It costs about $3,000.', 'Expect around $4,000.'])
    expect(range).toEqual({ currency: 'USD', low: 3000, high: 4000, answers: 2 })
  })

  it('picks the currency the most answers used', () => {
    const range = consensusRange([
      'Roughly $3,000 per person.',
      'Roughly $4,000 per person.',
      'That is about 400,000 KES.',
    ])
    expect(range?.currency).toBe('USD')
    expect(range?.answers).toBe(2)
  })

  it('does not sweep up years, percentages, or bare numbers', () => {
    const range = consensusRange([
      'In 2026, about 70% of visitors book 6 months ahead, paying $3,000.',
      'Since 2024, some 65% book early, at $4,000.',
    ])
    expect(range).toEqual({ currency: 'USD', low: 3000, high: 4000, answers: 2 })
  })

  it('does not depend on the order the answers arrive in', () => {
    const answers = ['$2,000 to $4,000.', '$2,500 to $5,000.', '$3,000 to $6,000.']
    const forwards = consensusRange(answers)
    const backwards = consensusRange([...answers].reverse())
    expect(forwards).toEqual(backwards)
  })
})

describe('describeConsensus', () => {
  it('reads as a range', () => {
    expect(describeConsensus({ currency: 'USD', low: 2500, high: 5000, answers: 3 })).toBe(
      'USD 2,500 to USD 5,000, across 3 answers',
    )
  })

  it('collapses to one figure when the ends match', () => {
    expect(describeConsensus({ currency: 'KES', low: 275_000, high: 275_000, answers: 2 })).toBe(
      'KES 275,000, across 2 answers',
    )
  })
})
