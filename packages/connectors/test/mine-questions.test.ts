import { describe, expect, it } from 'vitest'
import { mineQuestions } from '../src/questions/mine.js'
import type { SearchAnalyticsRow } from '../src/gsc/types.js'

const row = (query: string, impressions = 100, position = 22): SearchAnalyticsRow => ({
  keys: [query],
  clicks: 0,
  impressions,
  ctr: 0,
  position,
})

describe('mineQuestions', () => {
  it('takes question-shaped queries from Search Console, with their numbers', () => {
    const [first] = mineQuestions({
      rows: [row('how much do floor tiles cost in nairobi', 320, 18)],
    })

    expect(first).toMatchObject({
      question: 'how much do floor tiles cost in nairobi',
      source: 'search-console',
      impressions: 320,
      position: 18,
    })
  })

  it('ignores a query that is not a question', () => {
    expect(mineQuestions({ rows: [row('rangau tiles rongai')] })).toEqual([])
  })

  it('ignores a question with too few impressions to mean anything', () => {
    expect(mineQuestions({ rows: [row('how do i clean tiles', 2)] })).toEqual([])
  })

  it('takes People Also Ask questions as they come', () => {
    const mined = mineQuestions({ peopleAlsoAsk: ['How are floor tiles installed?'] })

    expect(mined).toEqual([
      {
        question: 'How are floor tiles installed?',
        source: 'people-also-ask',
        variants: [],
      },
    ])
  })

  it('puts measured demand above suggested demand', () => {
    // A question this site is already shown for outranks one Google merely suggests, whatever
    // order they arrive in. They are not the same claim and must not sort as if they were.
    const mined = mineQuestions({
      peopleAlsoAsk: ['How are floor tiles installed?'],
      rows: [row('how much do floor tiles cost', 40)],
    })

    expect(mined.map((entry) => entry.source)).toEqual(['search-console', 'people-also-ask'])
  })

  it('groups phrasings of one question and keeps the strongest as the headline', () => {
    const mined = mineQuestions({
      rows: [row('how much do floor tiles cost', 40), row('floor tiles cost how much', 300)],
    })

    expect(mined).toHaveLength(1)
    expect(mined[0]?.question).toBe('floor tiles cost how much')
    expect(mined[0]?.variants).toEqual(['how much do floor tiles cost'])
  })

  it('lets Search Console win the headline over People Also Ask for the same question', () => {
    // Whichever arrived first, the phrasing with real impressions is the one to show: it carries
    // a number a reader can weigh.
    const mined = mineQuestions({
      peopleAlsoAsk: ['How much do floor tiles cost?'],
      rows: [row('how much do floor tiles cost', 40)],
    })

    expect(mined).toHaveLength(1)
    expect(mined[0]?.source).toBe('search-console')
    expect(mined[0]?.variants).toEqual(['How much do floor tiles cost?'])
  })

  it('caps the list, because it is read by a person', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`how do i clean ${i} tile`, 50 + i))

    expect(mineQuestions({ rows })).toHaveLength(20)
    expect(mineQuestions({ rows, limit: 5 })).toHaveLength(5)
  })

  it('returns nothing when neither source produced anything', () => {
    expect(mineQuestions({})).toEqual([])
  })
})
