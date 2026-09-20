import type { SearchEvidence } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { evaluateCannibalisation, type CannibalisationInput } from '../src/gsc/cannibalisation.js'
import type { SearchAnalyticsRow } from '../src/gsc/types.js'

const row = (
  query: string,
  page: string,
  over: Partial<SearchAnalyticsRow> = {},
): SearchAnalyticsRow => ({
  keys: [query, page],
  clicks: 0,
  impressions: 100,
  ctr: 0,
  position: 14,
  ...over,
})

const run = (rows: SearchAnalyticsRow[]) =>
  evaluateCannibalisation({
    siteId: 's1',
    siteUrl: 'https://example.com',
    startDate: '2026-06-14',
    endDate: '2026-07-12',
    rows,
  } satisfies CannibalisationInput)

describe('evaluateCannibalisation', () => {
  it('raises a finding when two pages split one query', () => {
    const findings = run([
      row('floor tiles nairobi', 'https://example.com/tiles', { impressions: 600, position: 12 }),
      row('floor tiles nairobi', 'https://example.com/flooring', {
        impressions: 400,
        position: 18,
      }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('CONTENT-001')
    expect(findings[0]?.axis).toBe('content')
    expect(findings[0]?.fixable).toBe(false)
    expect(findings[0]?.affectedUrls).toEqual([
      'https://example.com/tiles',
      'https://example.com/flooring',
    ])
  })

  it('records the split per page as evidence, with the best position', () => {
    const findings = run([
      row('floor tiles nairobi', 'https://example.com/tiles', {
        impressions: 600,
        clicks: 12,
        position: 12,
      }),
      row('floor tiles nairobi', 'https://example.com/flooring', {
        impressions: 400,
        clicks: 3,
        position: 18,
      }),
    ])

    const evidence = findings[0]?.evidence as SearchEvidence
    expect(evidence.kind).toBe('search')
    // The whole claim is "these pages, this split". Summarising it away would leave the reader
    // nothing to check.
    expect(evidence.competingUrls).toEqual([
      { url: 'https://example.com/tiles', impressions: 600, clicks: 12, position: 12 },
      { url: 'https://example.com/flooring', impressions: 400, clicks: 3, position: 18 },
    ])
    expect(evidence.position).toBe(12)
    expect(evidence.impressions).toBe(1000)
    expect(evidence.clicks).toBe(15)
  })

  it('ignores a page with a trivial share of the query', () => {
    // Google showed the second page a handful of times out of a thousand. That is not two pages
    // competing, and treating it as one would raise a finding on almost every query.
    const findings = run([
      row('floor tiles nairobi', 'https://example.com/tiles', { impressions: 990, position: 12 }),
      row('floor tiles nairobi', 'https://example.com/blog/tile-care', {
        impressions: 10,
        position: 40,
      }),
    ])

    expect(findings).toHaveLength(0)
  })

  it('leaves a query alone when the site already holds a top-three spot', () => {
    const findings = run([
      row('rangau tiles', 'https://example.com/', { impressions: 600, position: 1.4 }),
      row('rangau tiles', 'https://example.com/about', { impressions: 400, position: 9 }),
    ])

    expect(findings).toHaveLength(0)
  })

  it('ignores a query with too few impressions to be a trend', () => {
    const findings = run([
      row('obscure query', 'https://example.com/a', { impressions: 20 }),
      row('obscure query', 'https://example.com/b', { impressions: 15 }),
    ])

    expect(findings).toHaveLength(0)
  })

  it('ignores rows that carry no page, such as a query-only request', () => {
    // measureSearch hands the same evaluator both row shapes; the wrong shape must be silently
    // skipped rather than producing a finding with an undefined URL.
    const findings = run([
      { keys: ['floor tiles'], clicks: 1, impressions: 900, ctr: 0.001, position: 14 },
    ])

    expect(findings).toHaveLength(0)
  })

  it('states a falsification a human can actually run', () => {
    const findings = run([
      row('floor tiles nairobi', 'https://example.com/tiles', { impressions: 600, position: 12 }),
      row('floor tiles nairobi', 'https://example.com/flooring', {
        impressions: 400,
        position: 18,
      }),
    ])

    expect(findings[0]?.falsification).toContain('80%')
    expect(findings[0]?.falsification).toContain('28 days')
  })

  it('gives each query a stable id, so a re-run recognises the same finding', () => {
    const rows = [
      row('Floor Tiles Nairobi', 'https://example.com/tiles', { impressions: 600, position: 12 }),
      row('Floor Tiles Nairobi', 'https://example.com/flooring', {
        impressions: 400,
        position: 18,
      }),
    ]

    expect(run(rows)[0]?.id).toBe('CONTENT-001#floor tiles nairobi')
    // Reversing the row order must not change the identity; Search Console does not promise one.
    expect(run([...rows].reverse())[0]?.id).toBe('CONTENT-001#floor tiles nairobi')
  })
})
