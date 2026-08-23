import { describe, expect, it, vi } from 'vitest'
import { createDataForSeoBacklinks } from '../src/backlinks/dataforseo.js'
import { BacklinkRequestError } from '../src/backlinks/types.js'
import { DataForSeoError } from '../src/dataforseo/request.js'
import { createDataForSeoKeywords, MAX_LIMIT } from '../src/keywords/dataforseo.js'

/**
 * The contract test for DataForSEO (CLAUDE.md: every external API client needs one).
 *
 * It pins our *reading* of the vendor's documented shape. The failure mode when a vendor moves a
 * field is not a crash but a surface that quietly returns nothing while looking healthy, which on
 * a paid dependency means still being billed for it. These fixtures are the documented shape, so a
 * vendor change goes red here rather than going quiet in production.
 *
 * The envelope tests matter as much as the field tests. DataForSEO can fail in three ways and only
 * one of them is an HTTP error.
 */

const CREDENTIALS = { login: 'user', password: 'pass' }

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

/** The v3 envelope, with one successful task carrying one result. */
const envelope = (result: unknown) => ({
  status_code: 20000,
  status_message: 'Ok.',
  tasks: [{ status_code: 20000, status_message: 'Ok.', result: [result] }],
})

describe('the DataForSEO backlinks provider', () => {
  const provider = (fetchImpl: typeof fetch) =>
    createDataForSeoBacklinks({ ...CREDENTIALS, fetch: fetchImpl })

  it('reads the total and the enumerated slice as two different facts', async () => {
    const result = await provider(
      json(
        envelope({
          target: 'heartbeestsafaris.com',
          total_count: 431,
          items_count: 2,
          items: [
            { domain: 'nation.africa', rank: 412, backlinks: 3 },
            { domain: 'traveller.co.uk', rank: 288, backlinks: 1 },
          ],
        }),
      ),
    ).referringDomains('heartbeestsafaris.com', 100)

    // 431 domains link to the site; we paid to enumerate 2 of them. Conflating those would make
    // every set-difference finding a statement about the wrong population.
    expect(result.total).toBe(431)
    expect(result.domains).toHaveLength(2)
    expect(result.limit).toBe(100)
    expect(result.domains[0]?.domain).toBe('nation.africa')
  })

  it('sends the target, the limit and a rank ordering', async () => {
    const fetchImpl = json(envelope({ total_count: 0, items: [] }))
    await provider(fetchImpl).referringDomains('https://heartbeestsafaris.com/some/page', 25)

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const [task] = JSON.parse(init.body as string) as {
      target: string
      limit: number
      order_by: string[]
    }[]

    // The host, not the URL: the vendor indexes domains, and sending a path would measure a page.
    expect(task?.target).toBe('heartbeestsafaris.com')
    expect(task?.limit).toBe(25)
    // Highest authority first, so a truncated slice is the most useful part rather than a random one.
    expect(task?.order_by).toEqual(['rank,desc'])
  })

  it('authenticates with Basic auth and never puts the credentials in an error', async () => {
    const fetchImpl = json({ status_code: 40401, status_message: 'Not Found.' })

    await expect(provider(fetchImpl).referringDomains('heartbeestsafaris.com')).rejects.toThrow(
      DataForSeoError,
    )

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const header = (init.headers as Record<string, string>).authorization
    expect(header).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)

    // An error string is the most likely thing to reach a log, an issue or a screenshot, and
    // these are live billable credentials.
    await expect(
      provider(json({ status_code: 40401, status_message: 'Not Found.' })).referringDomains(
        'x.com',
      ),
    ).rejects.not.toThrow(/pass/)
  })

  it('treats a domain with no backlinks as zero rather than as a failure', async () => {
    // The vendor returns no result at all for a target it has nothing on. That is a fact about
    // the domain, and turning it into an exception would take the axis down for a true answer.
    const result = await provider(
      json({ status_code: 20000, tasks: [{ status_code: 20000 }] }),
    ).referringDomains('brandnew.example')

    expect(result.total).toBe(0)
    expect(result.domains).toEqual([])
  })

  it('catches a failed task hiding inside a successful response', async () => {
    // A 200, a fine top-level code, and a failed task inside it. Checking only the HTTP status
    // would turn a broken integration into a silently empty axis.
    await expect(
      provider(
        json({
          status_code: 20000,
          tasks: [{ status_code: 40501, status_message: 'Invalid Field: target.' }],
        }),
      ).referringDomains('heartbeestsafaris.com'),
    ).rejects.toThrow(/Invalid Field/)
  })

  it('drops rows it cannot resolve to a host rather than counting them', async () => {
    const result = await provider(
      json(envelope({ total_count: 3, items: [{ domain: 'ok.example' }, { domain: '' }, {}] })),
    ).referringDomains('heartbeestsafaris.com')

    // A row with no usable host cannot be compared against a mention, so keeping it would inflate
    // the overlap arithmetic with something that can never match.
    expect(result.domains).toEqual([{ domain: 'ok.example' }])
  })

  it('reports all-nofollow only when it knows, and refuses when it does not', async () => {
    const result = await provider(
      json(
        envelope({
          total_count: 3,
          items: [
            { domain: 'a.example', referring_pages: 4, referring_pages_nofollow: 4 },
            { domain: 'b.example', referring_pages: 4, referring_pages_nofollow: 1 },
            { domain: 'c.example' },
          ],
        }),
      ),
    ).referringDomains('heartbeestsafaris.com')

    expect(result.domains[0]?.nofollow).toBe(true)
    expect(result.domains[1]?.nofollow).toBe(false)
    // Not knowing and knowing-it-is-followed are different facts, and only one is good news.
    expect(result.domains[2]?.nofollow).toBeUndefined()
  })

  it('refuses a target that is not a domain before spending anything', async () => {
    const fetchImpl = json(envelope({}))

    await expect(provider(fetchImpl).referringDomains('not a domain')).rejects.toThrow(
      BacklinkRequestError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the DataForSEO keywords provider', () => {
  const provider = (fetchImpl: typeof fetch) =>
    createDataForSeoKeywords({ ...CREDENTIALS, fetch: fetchImpl })

  const ideasEnvelope = envelope({
    seed_keywords: ['kenya safari'],
    total_count: 2,
    items: [
      {
        keyword: 'kenya safari cost',
        keyword_info: { search_volume: 2400, competition: 0.42, cpc: 1.35 },
      },
      { keyword: 'best kenya safari', keyword_info: { search_volume: 880, competition: null } },
    ],
  })

  it('reads the keyword and its volume, competition and cost', async () => {
    const ideas = await provider(json(ideasEnvelope)).ideas('kenya safari')

    expect(ideas).toEqual([
      { keyword: 'kenya safari cost', searchVolume: 2400, competition: 0.42, cpc: 1.35 },
      // A missing field is null, not zero. Zero competition is a claim; absent is not.
      { keyword: 'best kenya safari', searchVolume: 880, competition: null, cpc: null },
    ])
  })

  it('translates an ISO country into a location name the vendor understands', async () => {
    const fetchImpl = json(ideasEnvelope)
    await provider(fetchImpl).ideas('kenya safari', { country: 'ke' })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const [task] = JSON.parse(init.body as string) as {
      location_name: string
      keywords: string[]
    }[]

    // Search volume is per-market, so a wrong or defaulted location measures somebody else's demand.
    expect(task?.location_name).toBe('Kenya')
    expect(task?.keywords).toEqual(['kenya safari'])
  })

  it('bounds the limit at the vendor ceiling, so a caller cannot spend past it', async () => {
    const fetchImpl = json(ideasEnvelope)
    await provider(fetchImpl).ideas('kenya safari', { limit: 99_999 })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const [task] = JSON.parse(init.body as string) as { limit: number }[]

    expect(task?.limit).toBe(MAX_LIMIT)
  })

  it('returns nothing for a seed with no ideas, rather than failing', async () => {
    const ideas = await provider(
      json({ status_code: 20000, tasks: [{ status_code: 20000, result: null }] }),
    ).ideas('a phrase nobody searches for')

    expect(ideas).toEqual([])
  })

  it('skips an item with no keyword string', async () => {
    const ideas = await provider(
      json(envelope({ items: [{ keyword_info: { search_volume: 10 } }, { keyword: '  ' }] })),
    ).ideas('kenya safari')

    expect(ideas).toEqual([])
  })
})
