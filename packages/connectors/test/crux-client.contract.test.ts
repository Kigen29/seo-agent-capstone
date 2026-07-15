import { describe, expect, it, vi } from 'vitest'
import { createCruxClient, CruxRateLimitError } from '../src/crux/client.js'

/**
 * A contract test: it pins the exact shape we expect from the CrUX API, so if Google changes
 * that shape we find out from a red test rather than from a production audit quietly reporting
 * nothing. CLAUDE.md requires one of these per external client, and this is why: the schema is
 * theirs to change without telling us.
 *
 * The fetch is mocked. This tests our handling of CrUX's responses, not CrUX itself; the real
 * API was exercised by hand against the live key before this was written.
 */

const OK_BODY = {
  record: {
    key: { origin: 'https://example.com' },
    metrics: {
      largest_contentful_paint: { percentiles: { p75: 4200 } },
      interaction_to_next_paint: { percentiles: { p75: 150 } },
      // CrUX returns CLS as a string to preserve precision. If we ever stop coercing it, this
      // is the fixture that catches it.
      cumulative_layout_shift: { percentiles: { p75: '0.30' } },
    },
    collectionPeriod: {
      firstDate: { year: 2026, month: 6, day: 16 },
      lastDate: { year: 2026, month: 7, day: 13 },
    },
  },
}

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)

describe('the CrUX client', () => {
  it('parses a record, coercing the string CLS and banding every metric', async () => {
    const fetch = respond(200, OK_BODY)
    const client = createCruxClient({ apiKey: 'k', fetch })

    const result = await client.origin('https://example.com/some/page')

    expect(result.found).toBe(true)
    if (!result.found) return

    expect(result.record.metrics).toEqual([
      { metric: 'lcp', p75: 4200, band: 'poor' },
      { metric: 'inp', p75: 150, band: 'good' },
      { metric: 'cls', p75: 0.3, band: 'poor' },
    ])
    expect(result.record.collectionPeriod).toEqual({
      firstDate: '2026-06-16',
      lastDate: '2026-07-13',
    })
  })

  it('queries the origin, not the full page URL', async () => {
    // CrUX derives the origin itself, but sending it a full path invites a per-URL record we
    // did not ask for. The body must carry the origin.
    const fetch = respond(200, OK_BODY)
    const client = createCruxClient({ apiKey: 'k', fetch })

    await client.origin('https://example.com/deep/path?q=1')

    const body = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual({ origin: 'https://example.com' })
  })

  it('treats a 404 as "no field data", not an error', async () => {
    // The case the whole design turns on. A small site is absent from CrUX, and that absence
    // must surface as a clean "no data" that leaves the performance axis honestly unmeasured,
    // never as a thrown error that fails the audit or as an empty record that scores as fast.
    const fetch = respond(404, { error: { status: 'NOT_FOUND' } })
    const client = createCruxClient({ apiKey: 'k', fetch })

    const result = await client.origin('https://tiny.example.com')

    expect(result).toEqual({ found: false, reason: 'no_field_data' })
  })

  it('throws a typed error on a rate limit, so a caller can back off', async () => {
    const fetch = respond(429, { error: { status: 'RESOURCE_EXHAUSTED' } })
    const client = createCruxClient({ apiKey: 'k', fetch })

    await expect(client.origin('https://example.com')).rejects.toBeInstanceOf(CruxRateLimitError)
  })

  it('throws on an unexpected status rather than pretending there was no data', async () => {
    // A 500 is not "no field data". Swallowing it as an empty record would turn a Google
    // outage into a silent, wrong "this site has no measurable performance".
    const fetch = respond(500, { error: 'boom' })
    const client = createCruxClient({ apiKey: 'k', fetch })

    await expect(client.origin('https://example.com')).rejects.toThrow(/500/)
  })

  it('drops a metric whose value will not parse, rather than banding a NaN', async () => {
    const fetch = respond(200, {
      record: {
        ...OK_BODY.record,
        metrics: { largest_contentful_paint: { percentiles: { p75: 'not-a-number' } } },
      },
    })
    const client = createCruxClient({ apiKey: 'k', fetch })

    const result = await client.origin('https://example.com')

    expect(result.found).toBe(true)
    if (result.found) expect(result.record.metrics).toEqual([])
  })
})
