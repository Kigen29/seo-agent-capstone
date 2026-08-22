import { evidenceSchema, type Evidence } from '@seo/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EvidenceBlock } from './evidence'

/**
 * The evidence panel, per variant.
 *
 * This suite exists because of a defect it would have caught. The `citation` variant shipped in
 * Sprint 3, was rendered in the pull-request body, and was never rendered here: the switch fell
 * off the end and React treats the resulting `undefined` as a legal, empty child. Every
 * AI-visibility finding therefore showed a blank evidence panel while the type checker, the
 * linter, and the end-to-end suite all stayed green.
 *
 * Fixtures are parsed through the real `evidenceSchema` rather than cast, so a test cannot pass
 * on a shape production would reject. That matters more than usual here: the whole point of this
 * panel is that a human can check the claim, and evidence the schema would not accept is not
 * evidence.
 */

const parse = (input: unknown): Evidence => evidenceSchema.parse(input)

const render = (evidence: Evidence): string =>
  renderToStaticMarkup(<EvidenceBlock evidence={evidence} />)

const citation = (over: Record<string, unknown> = {}): Evidence =>
  parse({
    kind: 'citation',
    observedAt: '2026-08-02T00:00:00.000Z',
    source: 'serp',
    prompt: 'best safari operator in kenya',
    engines: ['chatgpt', 'perplexity'],
    pollsRun: 6,
    citedCount: 2,
    daysPolled: 3,
    matchedSources: ['https://example.com/tours'],
    citedCompetitors: ['rivalsafaris.com'],
    ...over,
  })

describe('citation evidence', () => {
  it('leads with the count the whole axis rests on', () => {
    const html = render(citation())

    // "cited in 2 of 6 checks, across 3 days" is the claim. A bare "cited" would be the
    // overclaim ADR-0015 exists to refuse, so the numbers are not decoration.
    expect(html).toContain('cited in 2 of 6 checks')
    expect(html).toContain('across 3 days')
  })

  it('names the engines and the prompt that was asked', () => {
    const html = render(citation())

    expect(html).toContain('best safari operator in kenya')
    expect(html).toContain('chatgpt, perplexity')
  })

  it('shows the matched sources, which are what make the finding falsifiable', () => {
    const html = render(citation())

    expect(html).toContain('https://example.com/tours')
  })

  it('says so when nothing cited the site, rather than omitting the row', () => {
    // An absent row and a zero row read identically to someone who does not know the row was
    // supposed to be there, and on AIV-001 the empty list IS the finding.
    const html = render(citation({ matchedSources: [], citedCount: 0 }))

    expect(html).toContain('no answer cited this site')
  })

  it('names the competitors cited alongside, and omits the line when there are none', () => {
    expect(render(citation())).toContain('rivalsafaris.com')
    expect(render(citation({ citedCompetitors: [] }))).not.toContain('also cited')
  })

  it('states the consensus range with the number of answers behind it', () => {
    const html = render(
      citation({ consensus: { currency: 'USD', low: 3000, high: 4000, answers: 4 } }),
    )

    expect(html).toContain('USD 3,000 to 4,000')
    expect(html).toContain('4 answers named a figure')
  })

  it('omits the consensus line when no answer named a figure', () => {
    expect(render(citation())).not.toContain('the answers agreed on')
  })

  it('carries the stability caveat, so the counts are not read as a citation', () => {
    const html = render(citation())

    expect(html).toContain('45%')
    expect(html).toContain('three days')
  })
})

describe('every evidence variant renders something', () => {
  // The property that actually protects the panel. The return type annotation on EvidenceBlock
  // makes a missing case a compile error, and this asserts the runtime half: no variant may
  // render to empty markup, which is the exact symptom the citation variant had.
  const oneOfEach: Evidence[] = [
    parse({
      kind: 'http',
      observedAt: '2026-08-02T00:00:00.000Z',
      source: 'crawler',
      url: 'https://example.com/',
      status: 301,
      redirectChain: ['https://example.com/', 'https://www.example.com/'],
    }),
    parse({
      kind: 'markup',
      observedAt: '2026-08-02T00:00:00.000Z',
      source: 'crawler',
      url: 'https://example.com/',
      locator: 'head > title',
      snippet: '',
    }),
    parse({
      kind: 'metric',
      observedAt: '2026-08-02T00:00:00.000Z',
      source: 'crux',
      metric: 'LCP',
      value: 4.2,
      unit: 's',
      percentile: 75,
    }),
    parse({
      kind: 'file',
      observedAt: '2026-08-02T00:00:00.000Z',
      source: 'crawler',
      path: '/robots.txt',
      excerpt: 'User-agent: GPTBot\nDisallow: /',
    }),
    parse({
      kind: 'graph',
      observedAt: '2026-08-02T00:00:00.000Z',
      source: 'crawler',
      url: 'https://example.com/orphan',
      inboundInternalLinks: 0,
      clickDepth: null,
    }),
    parse({
      kind: 'search',
      observedAt: '2026-08-02T00:00:00.000Z',
      source: 'gsc',
      query: 'kenya safari',
      position: 11.4,
      impressions: 2400,
      clicks: 32,
      ctr: 0.013,
      startDate: '2026-07-01',
      endDate: '2026-07-28',
    }),
    citation(),
  ]

  it.each(oneOfEach.map((evidence) => [evidence.kind, evidence] as const))(
    '%s renders non-empty markup',
    (_kind, evidence) => {
      expect(render(evidence).trim()).not.toBe('')
    },
  )

  it('covers every kind the schema allows', () => {
    // Guards against this suite silently falling behind the union: add a variant to core and
    // this fails until a fixture for it is added above.
    const covered = new Set(oneOfEach.map((evidence) => evidence.kind))
    expect(covered.size).toBe(evidenceSchema.options.length)
  })
})
