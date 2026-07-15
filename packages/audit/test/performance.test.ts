import { describe, expect, it, vi } from 'vitest'
import { measurePerformance } from '../src/performance.js'

/**
 * The three meanings of "no performance findings", each of which must stay distinct. This is
 * the honesty the scorecard depends on: an axis that was not measured must never be
 * confused with one that was measured and found clean, and a site absent from CrUX must never
 * be confused with a fast one.
 *
 * A mocked fetch, because what is under test is our reading of CrUX's answers, not CrUX.
 */
const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)

const cruxBody = (lcpMs: number) => ({
  record: {
    key: { origin: 'https://example.com' },
    metrics: { largest_contentful_paint: { percentiles: { p75: lcpMs } } },
    collectionPeriod: {
      firstDate: { year: 2026, month: 6, day: 16 },
      lastDate: { year: 2026, month: 7, day: 13 },
    },
  },
})

describe('measurePerformance', () => {
  it('is unmeasured, and says how to switch it on, when there is no API key', async () => {
    const result = await measurePerformance('s1', 'https://example.com', undefined)

    expect(result.findings).toEqual([])
    expect(result.coverage.checksRun).toBe(0)
    expect(result.coverage.note).toMatch(/GOOGLE_CRUX_API_KEY/)
  })

  it('is unmeasured, and blames traffic not speed, when CrUX has no data for the origin', async () => {
    // The most important distinction in the file. A site absent from CrUX is unmeasured, not
    // fast. Scoring it would be inventing a number from nothing.
    const fetch = respond(404, { error: { status: 'NOT_FOUND' } })

    const result = await measurePerformance('s1', 'https://tiny.example.com', 'key', fetch)

    expect(result.findings).toEqual([])
    expect(result.coverage.checksRun).toBe(0)
    expect(result.coverage.note).toMatch(/traffic/i)
    expect(result.coverage.note).not.toMatch(/GOOGLE_CRUX_API_KEY/)
  })

  it('is measured, with findings, when CrUX returns field data with a poor metric', async () => {
    const fetch = respond(200, cruxBody(4500))

    const result = await measurePerformance('s1', 'https://example.com', 'key', fetch)

    expect(result.coverage.checksRun).toBe(3)
    expect(result.coverage.note).toMatch(/75th percentile/)
    expect(result.coverage.note).toMatch(/28 days/)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.ruleId).toBe('PERF-001')
    expect(result.findings[0]?.axis).toBe('performance')
  })

  it('is measured, with zero findings, when CrUX returns field data that is all good', async () => {
    // Measured and clean is a completely different claim from unmeasured, and the check count
    // is what carries the difference: 3 checks ran and passed, versus 0 checks run.
    const fetch = respond(200, cruxBody(1800))

    const result = await measurePerformance('s1', 'https://example.com', 'key', fetch)

    expect(result.coverage.checksRun).toBe(3)
    expect(result.findings).toEqual([])
  })

  it('downgrades to unmeasured for the run, rather than failing the audit, on a CrUX error', async () => {
    // The crawl and the other seven axes are real. A CrUX outage should cost us the
    // performance axis for this run, not the whole audit.
    const fetch = respond(500, { error: 'boom' })

    const result = await measurePerformance('s1', 'https://example.com', 'key', fetch)

    expect(result.findings).toEqual([])
    expect(result.coverage.checksRun).toBe(0)
    expect(result.coverage.note).toMatch(/this run/i)
  })
})
