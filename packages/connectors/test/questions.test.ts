import type { SearchEvidence } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { evaluateQuestionGaps, type PageSummary } from '../src/gsc/questions.js'
import type { SearchAnalyticsRow } from '../src/gsc/types.js'

const row = (query: string, over: Partial<SearchAnalyticsRow> = {}): SearchAnalyticsRow => ({
  keys: [query],
  clicks: 0,
  impressions: 200,
  ctr: 0,
  position: 30,
  ...over,
})

const HOME: PageSummary = { url: 'https://example.com/', title: 'Rangau Tiles', h1s: ['Rangau'] }

const run = (rows: SearchAnalyticsRow[], pages: PageSummary[] = [HOME]) =>
  evaluateQuestionGaps({
    siteId: 's1',
    siteUrl: 'https://example.com',
    startDate: '2026-06-14',
    endDate: '2026-07-12',
    rows,
    pages,
  })

describe('evaluateQuestionGaps', () => {
  it('raises a question the site is shown for and has no page answering', () => {
    const findings = run([row('how much do floor tiles cost in nairobi')])

    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('CONTENT-002')
    expect(findings[0]?.axis).toBe('content')
    expect(findings[0]?.fixable).toBe(false)
    expect(findings[0]?.affectedUrls).toEqual(['https://example.com'])
  })

  it('stays quiet when a page already covers the subject', () => {
    // The page exists and ranks badly. That is a ranking problem, which quick-wins already
    // raises; telling the client to write a page they have is the worst failure this can have.
    const findings = run(
      [row('how much do floor tiles cost in nairobi')],
      [
        HOME,
        { url: 'https://example.com/tile-prices', title: 'Floor Tile Prices in Nairobi', h1s: [] },
      ],
    )

    expect(findings).toHaveLength(0)
  })

  it('ignores a query that is not a question', () => {
    expect(run([row('rangau tiles rongai')])).toHaveLength(0)
  })

  it('ignores a question the site already answers on page one', () => {
    expect(run([row('how to lay floor tiles', { position: 4.2 })])).toHaveLength(0)
  })

  it('ignores a question with too few impressions to be worth a page', () => {
    expect(run([row('how to lay floor tiles', { impressions: 5 })])).toHaveLength(0)
  })

  it('groups phrasings of one question into a single finding', () => {
    const findings = run([
      row('how much do floor tiles cost in nairobi', { impressions: 300 }),
      row('floor tile prices nairobi', { impressions: 120 }),
      row('what is the cost of floor tiles in nairobi', { impressions: 60 }),
    ])

    expect(findings).toHaveLength(1)
    // Impressions are summed across the phrasings, because one page would serve all of them.
    const evidence = findings[0]?.evidence as SearchEvidence
    expect(evidence.impressions).toBe(480)
    expect(evidence.query).toBe('how much do floor tiles cost in nairobi')
    expect(evidence.relatedQueries).toHaveLength(2)
    expect(findings[0]?.title).toContain('asked 3 ways')
  })

  it('measures nothing when the crawl found no pages', () => {
    // With nothing crawled, every question looks unanswered. Silence beats a page of findings
    // that are artefacts of missing input.
    expect(run([row('how much do floor tiles cost in nairobi')], [])).toHaveLength(0)
  })

  it('caps the findings and keeps the largest questions', () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(`how do i clean ${i} tile`, { impressions: 30 + i }),
    )

    const findings = run(rows)

    expect(findings).toHaveLength(10)
    // Sorted by impressions, so the cap drops the smallest rather than an arbitrary ten.
    expect((findings[0]?.evidence as SearchEvidence).impressions).toBe(43)
  })

  it('treats a question drawing hundreds of impressions as more severe', () => {
    expect(run([row('how do i clean floor tiles', { impressions: 40 })])[0]?.severity).toBe('low')
    expect(run([row('how do i clean floor tiles', { impressions: 400 })])[0]?.severity).toBe(
      'medium',
    )
  })

  it('recognises a Swahili question', () => {
    const findings = run([row('bei ya tiles nairobi', { impressions: 80 })])

    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toContain('bei ya tiles nairobi')
  })
})
