import { describe, expect, it, vi } from 'vitest'
import { createSerpApiProvider, serpApiKeys } from '../src/serp/serpapi.js'
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

describe('more than one key', () => {
  /** Answers by key: a Response, or a function of the request for one. */
  const byKey = (answers: Record<string, () => Response>) =>
    vi.fn(async (input: string) => {
      const key = new URL(input).searchParams.get('api_key') ?? ''
      return (answers[key] ?? (() => new Response('{}', { status: 500 })))()
    })

  const ok = () => new Response(JSON.stringify({ related_questions: [{ question: 'A?' }] }))
  const spent = () =>
    new Response(JSON.stringify({ error: 'Your account has run out of searches.' }), {
      status: 429,
    })
  const keysUsed = (fetchImpl: ReturnType<typeof vi.fn>) =>
    fetchImpl.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('api_key'))

  const withKeys = (apiKey: string, fetchImpl: ReturnType<typeof vi.fn>) =>
    createSerpApiProvider({ apiKey, fetch: fetchImpl as unknown as typeof fetch })

  it('reads a list in order, without blanks or repeats', () => {
    expect(serpApiKeys(' first , second,,first ')).toEqual(['first', 'second'])
    expect(serpApiKeys('only')).toEqual(['only'])
    expect(serpApiKeys('')).toEqual([])
  })

  it('uses the second key when the first account has no searches left', async () => {
    const fetchImpl = byKey({ first: spent, second: ok })
    const result = await withKeys('first,second', fetchImpl).relatedQuestions('q')

    expect(result.questions).toEqual(['A?'])
    expect(keysUsed(fetchImpl)).toEqual(['first', 'second'])
  })

  it('remembers a spent key, so it costs one refused request and not one per question', async () => {
    const fetchImpl = byKey({ first: spent, second: ok })
    const provider = withKeys('first,second', fetchImpl)
    await provider.relatedQuestions('one')
    await provider.relatedQuestions('two')
    await provider.relatedQuestions('three')

    expect(keysUsed(fetchImpl)).toEqual(['first', 'second', 'second', 'second'])
  })

  it.each([
    ['a 401', () => new Response('{}', { status: 401 })],
    ['a 403', () => new Response('{}', { status: 403 })],
    ['an invalid key said in a 200', () => new Response('{"error":"Invalid API key."}')],
    [
      'a spent account said in a 200',
      () => new Response('{"error":"Your account has run out of searches."}'),
    ],
  ])('moves on from %s', async (_name, refusal) => {
    const fetchImpl = byKey({ first: refusal, second: ok })

    await expect(withKeys('first,second', fetchImpl).relatedQuestions('q')).resolves.toEqual({
      query: 'q',
      questions: ['A?'],
    })
  })

  it('does not spend the second key on a failure that is not about the key', async () => {
    const broken = byKey({ first: () => new Response('{}', { status: 500 }), second: ok })
    await expect(withKeys('first,second', broken).relatedQuestions('q')).rejects.toThrow(
      SerpRequestError,
    )
    expect(keysUsed(broken)).toEqual(['first'])

    const refusedQuery = byKey({
      first: () => new Response('{"error":"Google has not returned any results for this query."}'),
      second: ok,
    })
    await expect(withKeys('first,second', refusedQuery).relatedQuestions('q')).rejects.toThrow()
    expect(keysUsed(refusedQuery)).toEqual(['first'])
  })

  it('fails with the last refusal when every key is spent, and names no key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = byKey({ 'first-secret': spent, 'second-secret': spent })

    await expect(
      withKeys('first-secret,second-secret', fetchImpl).relatedQuestions('q'),
    ).rejects.toThrow(expect.objectContaining({ status: 429 }))
    expect(keysUsed(fetchImpl)).toEqual(['first-secret', 'second-secret'])

    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('key 1 of 2')
    expect(logged).not.toContain('secret')
    warn.mockRestore()
  })

  it('behaves exactly as before with one key', async () => {
    const fetchImpl = byKey({ only: spent })

    await expect(withKeys('only', fetchImpl).relatedQuestions('q')).rejects.toThrow(
      SerpRequestError,
    )
    expect(keysUsed(fetchImpl)).toEqual(['only'])
  })
})

describe('People Also Ask', () => {
  const provider = (fetchImpl: typeof fetch) =>
    createSerpApiProvider({ apiKey: 'k', fetch: fetchImpl })

  it('reads the questions Google showed', () => {
    return provider(
      json({
        related_questions: [
          { question: 'How much do floor tiles cost in Kenya?' },
          { question: 'What is the best tile for a bathroom?' },
        ],
      }),
    )
      .relatedQuestions('floor tiles nairobi')
      .then((result) => {
        expect(result.questions).toEqual([
          'How much do floor tiles cost in Kenya?',
          'What is the best tile for a bathroom?',
        ])
      })
  })

  it('skips a row with no question text', async () => {
    // An empty string in front of somebody deciding what to write about is worse than one fewer
    // suggestion.
    const result = await provider(
      json({ related_questions: [{ question: '  ' }, {}, { question: 'A real one?' }] }),
    ).relatedQuestions('tiles')

    expect(result.questions).toEqual(['A real one?'])
  })

  it('treats no People Also Ask box as a fact, not a failure', async () => {
    const result = await provider(json({})).relatedQuestions('tiles')

    expect(result.questions).toEqual([])
  })

  it('asks from the country it was given, because the box is geographic', async () => {
    const fetchImpl = json({ related_questions: [] })
    await provider(fetchImpl).relatedQuestions('tiles', { country: 'ke' })

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('gl=ke')
  })
})
