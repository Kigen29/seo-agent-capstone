import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { GoldenCase } from '../src/dataset.js'
import { aggregate, scoreCase } from '../src/metrics.js'

const page = (url: string) => ({ url, html: '<html></html>', status: 200, headers: {} })

const caseWith = (over: Partial<GoldenCase> = {}): GoldenCase => ({
  id: 'case-1',
  source: 'a test',
  capturedAt: '2026-08-01T00:00:00.000Z',
  seed: 'https://example.com/',
  robotsTxt: '',
  sitemapUrls: [],
  llmsTxt: null,
  pages: [page('https://example.com/'), page('https://example.com/a')],
  checkedAndClear: [],
  expected: [],
  ...over,
})

const finding = (ruleId: string, urls: string[]): Finding =>
  ({ ruleId, affectedUrls: urls }) as Finding

describe('scoreCase', () => {
  it('counts a matched claim as a true positive', () => {
    const result = scoreCase(
      caseWith({
        expected: [
          {
            ruleId: 'TECH-006',
            urls: ['https://example.com/a'],
            why: 'no canonical link in the head',
          },
        ],
      }),
      [finding('TECH-006', ['https://example.com/a'])],
    )
    expect(result.truePositives).toBe(1)
    expect(result.precision).toBe(1)
    expect(result.recall).toBe(1)
  })

  it('scores a rule firing on the wrong page as a false positive, not a hallucination', () => {
    // The page exists and the rule was wrong about it. That is a threshold or parsing problem,
    // and it must not be reported as the engine inventing a URL.
    const result = scoreCase(caseWith(), [finding('TECH-006', ['https://example.com/a'])])
    expect(result.falsePositives).toBe(1)
    expect(result.hallucinations).toBe(0)
  })

  it('scores a finding about a page the crawl never saw as a hallucination', () => {
    const result = scoreCase(caseWith(), [finding('TECH-006', ['https://example.com/ghost'])])
    expect(result.hallucinations).toBe(1)
    expect(result.hallucinationRate).toBe(1)
    // Still a false positive too: it is both an invented page and an unlabelled claim. The two
    // numbers answer different questions and are not meant to partition the same total.
    expect(result.falsePositives).toBe(1)
  })

  it('reports precision as null when nothing was found, never as 1', () => {
    // Zero out of zero is not perfect. A rule engine that has stopped working entirely would
    // otherwise score a flawless precision and look like the best build ever shipped.
    const result = scoreCase(caseWith(), [])
    expect(result.precision).toBeNull()
    expect(result.hallucinationRate).toBeNull()
  })

  it('reports recall as null when the case labelled nothing', () => {
    expect(scoreCase(caseWith(), []).recall).toBeNull()
  })

  it('treats one finding over four URLs as four claims', () => {
    // TECH-011 groups pages sharing a title into a single finding; TECH-006 raises one per page.
    // Counting findings would score the same four assertions differently for a difference in
    // presentation, so the unit is the claim.
    const urls = ['https://example.com/', 'https://example.com/a']
    const result = scoreCase(
      caseWith({
        expected: [{ ruleId: 'TECH-011', urls, why: 'both pages carry the same title' }],
      }),
      [finding('TECH-011', urls)],
    )
    expect(result.truePositives).toBe(2)
    expect(result.recall).toBe(1)
  })

  it('matches a label and a finding that spell the same URL differently', () => {
    // The labeller writes what they typed; the engine reports what it crawled. A trailing slash
    // is not a disagreement about SEO, and scoring it as one would measure typing accuracy.
    const result = scoreCase(
      caseWith({
        pages: [page('https://example.com/'), page('https://example.com/a')],
        expected: [
          {
            ruleId: 'TECH-006',
            urls: ['https://example.com/a/'],
            why: 'head has no canonical element',
          },
        ],
      }),
      [finding('TECH-006', ['https://EXAMPLE.com/a'])],
    )
    expect(result.truePositives).toBe(1)
    expect(result.falseNegatives).toBe(0)
  })

  it('attributes a site-wide finding to the seed so it can be labelled', () => {
    const result = scoreCase(
      caseWith({
        expected: [
          {
            ruleId: 'TECH-003',
            urls: ['https://example.com/'],
            why: 'robots.txt declares no Sitemap: line',
          },
        ],
      }),
      [finding('TECH-003', [])],
    )
    expect(result.truePositives).toBe(1)
  })
})

describe('aggregate', () => {
  it('micro-averages, so a two-label case cannot outweigh a forty-label one', () => {
    const big = scoreCase(
      caseWith({
        id: 'big',
        expected: [
          { ruleId: 'TECH-006', urls: ['https://example.com/a'], why: 'no canonical in head' },
        ],
      }),
      [finding('TECH-006', ['https://example.com/a'])],
    )
    const small = scoreCase(caseWith({ id: 'small' }), [
      finding('TECH-019', ['https://example.com/']),
      finding('TECH-020', ['https://example.com/']),
    ])

    const rolled = aggregate([big, small])

    // 1 true positive against 2 false positives. Averaging the per-case precisions (1 and 0)
    // would report 0.5; the honest figure over the claims actually made is a third.
    expect(rolled.precision).toBeCloseTo(1 / 3)
    expect(rolled.cases).toBe(2)
  })

  it('is null-safe across cases that found nothing', () => {
    const rolled = aggregate([scoreCase(caseWith(), []), scoreCase(caseWith(), [])])
    expect(rolled.precision).toBeNull()
    expect(rolled.truePositives).toBe(0)
  })
})
