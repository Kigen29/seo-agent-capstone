import { describe, expect, it, vi } from 'vitest'
import { createSerpApiProvider } from '../src/serp/serpapi.js'
import { SerpRequestError } from '../src/serp/types.js'

/**
 * The contract test for SerpApi (CLAUDE.md: every external API client needs one).
 *
 * What it pins down is our *reading* of the vendor's shape. An external API's response is a promise
 * somebody else can break on a Tuesday, and the failure mode when they do is not a crash: it is an
 * axis that quietly reports nothing while looking healthy. These fixtures are the documented shape,
 * so if SerpApi moves a field, this goes red instead of production going quiet.
 */

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

const provider = (fetchImpl: typeof fetch) =>
  createSerpApiProvider({ apiKey: 'test-key', fetch: fetchImpl, country: 'ke' })

describe('the SerpApi provider', () => {
  it('flattens the AI Overview text blocks and keeps the references as sources', async () => {
    const result = await provider(
      json({
        ai_overview: {
          text_blocks: [
            { type: 'paragraph', snippet: 'A mid-range Kenyan safari runs $2,000 to $4,000.' },
            {
              type: 'list',
              list: [{ snippet: 'Park fees are extra.' }, { snippet: 'Peak season costs more.' }],
            },
          ],
          references: [
            { link: 'https://rivalsafaris.com/pricing', title: 'Pricing', snippet: 'From $2,000' },
            { link: 'https://heartbeestsafaris.com/costs' },
          ],
        },
      }),
    ).aiOverview('how much does a kenyan safari cost')

    expect(result.present).toBe(true)
    expect(result.text).toBe(
      'A mid-range Kenyan safari runs $2,000 to $4,000.\nPark fees are extra.\nPeak season costs more.',
    )
    expect(result.sources).toEqual([
      { url: 'https://rivalsafaris.com/pricing', title: 'Pricing', snippet: 'From $2,000' },
      { url: 'https://heartbeestsafaris.com/costs' },
    ])
  })

  it('reports no overview as absent rather than as a failure', async () => {
    // Plenty of queries simply have no AI Overview. Treating that as an error would turn "Google
    // chose not to answer this" into "the poll broke", and drop a day from a three-day window.
    const result = await provider(json({ organic_results: [] })).aiOverview('a niche query')

    expect(result.present).toBe(false)
    expect(result.text).toBe('')
    expect(result.sources).toEqual([])
  })

  it('does not pay twice for an overview deferred behind a page token', async () => {
    const result = await provider(json({ ai_overview: { page_token: 'abc123' } })).aiOverview('q')

    // Following the token is a second billable query for the same measurement. Declining is
    // honest and free; the day is recorded as "no overview".
    expect(result.present).toBe(false)
  })

  it('drops a reference with no link, which is not a source we could match', async () => {
    const result = await provider(
      json({
        ai_overview: {
          text_blocks: [{ snippet: 'Some answer.' }],
          references: [{ title: 'No link here' }, { link: 'https://example.com/a' }],
        },
      }),
    ).aiOverview('q')

    expect(result.sources).toEqual([{ url: 'https://example.com/a' }])
  })

  it('reads organic results and the result estimate for a mentions query', async () => {
    const result = await provider(
      json({
        organic_results: [
          { link: 'https://news.example/article', title: 'Heartbeest profiled', snippet: '...' },
          { link: 'https://blog.example/post' },
        ],
        search_information: { total_results: 1240 },
      }),
    ).mentions('"Heartbeest Safaris"')

    expect(result.sources).toHaveLength(2)
    expect(result.estimatedTotal).toBe(1240)
  })

  it('treats an error field in a 200 body as the failure it is', async () => {
    // SerpApi reports some failures as a 200 with an `error` field, which is exactly the shape
    // that turns a broken integration into a silently empty axis if nobody checks it.
    await expect(provider(json({ error: 'Invalid API key' })).aiOverview('q')).rejects.toThrow(
      SerpRequestError,
    )
  })

  it('never puts the API key in an error message', async () => {
    const failing = json({}, 401)

    // An error string is the most likely thing to reach a log, an issue, or a screenshot, and a
    // leaked SerpApi key is a live billable credential.
    await expect(provider(failing).aiOverview('q')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('test-key') }),
    )
  })

  it('asks from the configured country, because AI answers are geography-dependent', async () => {
    const fetchImpl = json({})
    await provider(fetchImpl).aiOverview('q', { country: 'ug' })

    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(url).toContain('gl=ug')
    expect(url).toContain('hl=en')
  })
})
