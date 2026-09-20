import { describe, expect, it, vi } from 'vitest'
import { createDataForSeoBacklinks, MAX_INTERSECTION_TARGETS } from '../src/backlinks/dataforseo.js'
import { BacklinkRequestError } from '../src/backlinks/types.js'
import { DataForSeoError } from '../src/dataforseo/request.js'
import {
  createDataForSeoKeywords,
  MAX_LIMIT,
  subtractKnownQueries,
} from '../src/keywords/dataforseo.js'

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

describe('the DataForSEO domain intersection', () => {
  const provider = (fetchImpl: typeof fetch) =>
    createDataForSeoBacklinks({ ...CREDENTIALS, fetch: fetchImpl })

  /**
   * The shape below was captured from a live call, not copied from the documentation, because the
   * documented description is ambiguous in the one place it matters: `domain_intersection` is
   * keyed by target position, and the `target` field inside each entry is the *referring* domain
   * repeated, not the competitor it links to.
   */
  const row = (
    domain: string,
    over: Partial<{ rank: number; spam: number; nofollow: 'none' | 'some' | 'all' }> = {},
  ) => ({
    domain_intersection: {
      '1': {
        target: domain,
        rank: over.rank ?? 200,
        backlinks: 10,
        referring_pages: 10,
        referring_pages_nofollow: over.nofollow === 'none' || !over.nofollow ? 0 : 10,
        backlinks_spam_score: over.spam ?? 0,
      },
      '2': {
        target: domain,
        rank: over.rank ?? 200,
        backlinks: 4,
        referring_pages: 4,
        referring_pages_nofollow: over.nofollow === 'all' ? 4 : 0,
        backlinks_spam_score: over.spam ?? 0,
      },
    },
    summary: { intersections_count: 2 },
  })

  it('reads the referring domain out of the per-target entries', async () => {
    const result = await provider(
      json(envelope({ total_count: 913, items: [row('nation.africa', { rank: 412 })] })),
    ).intersection(['rival-one.com', 'rival-two.com'], 'heartbeestsafaris.com')

    expect(result.domains).toEqual([
      {
        domain: 'nation.africa',
        intersections: 2,
        backlinks: 14,
        rank: 412,
        spamScore: 0,
        // Known to be followed, which is a different fact from not knowing.
        nofollow: false,
      },
    ])
    // The slice and the true total are different facts, as they are for referring domains.
    expect(result.total).toBe(913)
  })

  it('sends the targets keyed by position and excludes the client', async () => {
    const fetchImpl = json(envelope({ items: [] }))
    await provider(fetchImpl).intersection(
      ['rival-one.com', 'https://rival-two.com/pricing'],
      'heartbeestsafaris.com',
    )

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const [task] = JSON.parse(init.body as string) as {
      targets: Record<string, string>
      exclude_targets: string[]
      intersection_mode: string
    }[]

    expect(task?.targets).toEqual({ '1': 'rival-one.com', '2': 'rival-two.com' })
    // The exclusion is the gap. Doing it here rather than filtering our own slice afterwards is
    // what makes every row a domain that really does not link to the client.
    expect(task?.exclude_targets).toEqual(['heartbeestsafaris.com'])
    // 'partial' would return anything linking to any one rival, which is most of the web's farms.
    expect(task?.intersection_mode).toBe('all')
  })

  it('keeps the worst spam score across the targets, not the kindest', async () => {
    const mixed = row('linkfarm.example')
    mixed.domain_intersection['1'].backlinks_spam_score = 4
    mixed.domain_intersection['2'].backlinks_spam_score = 71

    const result = await provider(json(envelope({ items: [mixed] }))).intersection(
      ['rival-one.com'],
      'client.com',
    )

    expect(result.domains[0]?.spamScore).toBe(71)
  })

  it('only calls a domain nofollow when every link it gives is nofollow', async () => {
    // Nofollow on one competitor and followed on another is a followed domain: it can still pass
    // authority, so treating it as nofollow would drop a real opportunity from the list.
    const some = await provider(
      json(envelope({ items: [row('forum.example', { nofollow: 'some' })] })),
    ).intersection(['rival-one.com'], 'client.com')
    expect(some.domains[0]?.nofollow).toBe(false)

    const all = await provider(
      json(envelope({ items: [row('forum.example', { nofollow: 'all' })] })),
    ).intersection(['rival-one.com'], 'client.com')
    expect(all.domains[0]?.nofollow).toBe(true)
  })

  it('never asks the vendor a question with no comparable competitor', async () => {
    // A gap against nobody has no answer worth paying for, so no request is made at all.
    const fetchImpl = json(envelope({ items: [] }))
    const result = await provider(fetchImpl).intersection(['client.com'], 'client.com')

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({ targets: [], total: 0, domains: [] })
  })

  it('caps the targets it compares, because "links to all of them" collapses on a long list', async () => {
    const fetchImpl = json(envelope({ items: [] }))
    await provider(fetchImpl).intersection(['a.com', 'b.com', 'c.com', 'd.com'], 'client.com')

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const [task] = JSON.parse(init.body as string) as { targets: Record<string, string> }[]

    expect(Object.keys(task!.targets)).toHaveLength(MAX_INTERSECTION_TARGETS)
  })

  it('treats no intersecting domains as a fact, not a failure', async () => {
    const result = await provider(
      json({ status_code: 20000, tasks: [{ status_code: 20000, result: null }] }),
    ).intersection(['rival-one.com'], 'client.com')

    expect(result).toMatchObject({ total: 0, domains: [] })
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

describe('the DataForSEO keyword gap', () => {
  const provider = (fetchImpl: typeof fetch) =>
    createDataForSeoKeywords({ ...CREDENTIALS, fetch: fetchImpl })

  const gapRow = (keyword: string, volume: number | null, position: number | null) => ({
    keyword_data: {
      keyword,
      keyword_info: { search_volume: volume, competition: 0.4, cpc: 0.2 },
    },
    first_domain_serp_element: { rank_absolute: position, url: `https://rival.example/${keyword}` },
  })

  it('reads the competitor rankings and where they rank', async () => {
    const gap = await provider(
      json(envelope({ items: [gapRow('floor tiles nairobi', 210, 3)] })),
    ).gap('rangautiles.com', 'rival.example')

    expect(gap.keywords).toEqual([
      {
        keyword: 'floor tiles nairobi',
        searchVolume: 210,
        competition: 0.4,
        cpc: 0.2,
        competitorPosition: 3,
        competitorUrl: 'https://rival.example/floor tiles nairobi',
      },
    ])
  })

  it('asks the question in the only direction worth paying for', async () => {
    const fetchImpl = json(envelope({ items: [] }))
    await provider(fetchImpl).gap('https://rangautiles.com/', 'rival.example', { country: 'ke' })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const [task] = JSON.parse(init.body as string) as {
      target1: string
      target2: string
      intersections: boolean
      item_types: string[]
      location_name: string
    }[]

    // target1 is the competitor, because its rankings are what comes back. Sending these the
    // other way round and reading the same field reports the client's own rankings as the gap.
    expect(task?.target1).toBe('rival.example')
    expect(task?.target2).toBe('rangautiles.com')
    expect(task?.intersections).toBe(false)
    // Organic only: a paid placement is somebody's ad budget, not a ranking a client can earn.
    expect(task?.item_types).toEqual(['organic'])
    expect(task?.location_name).toBe('Kenya')
  })

  it('keeps a missing volume as null rather than zero', async () => {
    const gap = await provider(json(envelope({ items: [gapRow('obscure term', null, 8)] }))).gap(
      'client.com',
      'rival.example',
    )

    expect(gap.keywords[0]?.searchVolume).toBeNull()
  })

  it('skips a row with no keyword', async () => {
    const gap = await provider(
      json(envelope({ items: [{ keyword_data: { keyword: '  ' } }, gapRow('real', 10, 2)] })),
    ).gap('client.com', 'rival.example')

    expect(gap.keywords.map((entry) => entry.keyword)).toEqual(['real'])
  })

  it('treats no gap as a fact rather than a failure', async () => {
    const gap = await provider(
      json({ status_code: 20000, tasks: [{ status_code: 20000, result: null }] }),
    ).gap('client.com', 'rival.example')

    expect(gap.keywords).toEqual([])
  })
})

describe('subtractKnownQueries', () => {
  const gap = {
    client: 'client.com',
    competitor: 'rival.example',
    limit: 25,
    keywords: [
      {
        keyword: 'Floor Tiles Nairobi',
        searchVolume: 210,
        competition: null,
        cpc: null,
        competitorPosition: 3,
      },
      {
        keyword: 'bathroom tiles kenya',
        searchVolume: 170,
        competition: null,
        cpc: null,
        competitorPosition: 5,
      },
    ],
  }

  it('removes the keywords Search Console says the site already appears for', () => {
    // The correction nothing else in the category can make: a third-party index sees a small site
    // badly and reports terms it already ranks for as a gap.
    const result = subtractKnownQueries(gap, ['floor tiles nairobi'])

    expect(result.gap.keywords.map((entry) => entry.keyword)).toEqual(['bathroom tiles kenya'])
    expect(result.removed).toBe(1)
  })

  it('matches regardless of case and surrounding space', () => {
    expect(subtractKnownQueries(gap, ['  FLOOR TILES NAIROBI ']).removed).toBe(1)
  })

  it('changes nothing when Search Console had no queries at all', () => {
    // An empty set is "this site draws no impressions", not "subtract everything".
    const result = subtractKnownQueries(gap, [])

    expect(result.gap.keywords).toHaveLength(2)
    expect(result.removed).toBe(0)
  })
})
