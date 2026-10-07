import { describe, expect, it, vi } from 'vitest'
import {
  domainOf,
  MAX_COMPETITOR_CANDIDATES,
  suggestCompetitors,
  type CompetitorSuggestionLlm,
} from '../src/suggest-competitors.js'

const fake = (competitors: { domain: string; reason: string }[]) => {
  const object = vi.fn(async (_opts: unknown) => ({ output: { competitors } }))
  return { llm: { object } as unknown as CompetitorSuggestionLlm, object }
}

const SITE = 'https://www.heartbeestsafaris.com/'

/**
 * Competitor suggestions, the part that needs no network. The model drafts and nothing more: what
 * these tests hold is everything done to its answer before a person sees it. Whether a candidate
 * exists at all is checked by the API, which fetches it.
 */
describe('suggestCompetitors', () => {
  it('grounds the request in what the business says it offers and where, with one call', async () => {
    const { llm, object } = fake([])

    await suggestCompetitors(llm, 'tenant-1', {
      url: SITE,
      brand: 'Heartbeest Safaris',
      offering: 'Private guided safaris for small groups',
      market: 'Kenya',
      title: 'Heartbeest Safaris | Kenya safari tours',
      existing: ['rivalsafaris.com'],
    })

    expect(object).toHaveBeenCalledTimes(1)
    const call = object.mock.calls[0]![0] as unknown as { role: string; prompt: string }
    expect(call.role).toBe('smart')
    expect(call.prompt).toContain('What they offer, in their words: Private guided safaris')
    expect(call.prompt).toContain('Market: Kenya')
    expect(call.prompt).toContain('Already tracked (do not repeat): rivalsafaris.com')
  })

  it('reduces each answer to a bare domain', async () => {
    const { llm } = fake([
      { domain: 'https://www.RivalSafaris.com/tours?x=1', reason: 'Runs guided safaris in Kenya.' },
    ])

    expect(await suggestCompetitors(llm, 't', { url: SITE })).toEqual([
      { domain: 'rivalsafaris.com', reason: 'Runs guided safaris in Kenya.' },
    ])
  })

  it('never offers the site itself, under any spelling or subdomain', async () => {
    const { llm } = fake([
      { domain: 'heartbeestsafaris.com', reason: 'x' },
      { domain: 'www.heartbeestsafaris.com', reason: 'x' },
      { domain: 'blog.heartbeestsafaris.com', reason: 'x' },
    ])

    expect(await suggestCompetitors(llm, 't', { url: SITE })).toEqual([])
  })

  it('never offers a competitor that is already tracked, or the same one twice', async () => {
    const { llm } = fake([
      { domain: 'rivalsafaris.com', reason: 'Tracked already.' },
      { domain: 'new-rival.co.ke', reason: 'New.' },
      { domain: 'www.new-rival.co.ke', reason: 'Same again.' },
    ])

    const result = await suggestCompetitors(llm, 't', { url: SITE, existing: ['rivalsafaris.com'] })

    expect(result.map((entry) => entry.domain)).toEqual(['new-rival.co.ke'])
  })

  it('drops platforms a business is listed on and does not compete with', async () => {
    const { llm } = fake([
      { domain: 'tripadvisor.com', reason: 'Reviews.' },
      { domain: 'facebook.com', reason: 'Social.' },
      { domain: 'booking.com', reason: 'Marketplace.' },
      { domain: 'rivalsafaris.com', reason: 'A real competitor.' },
    ])

    const result = await suggestCompetitors(llm, 't', { url: SITE })

    expect(result.map((entry) => entry.domain)).toEqual(['rivalsafaris.com'])
  })

  it('drops anything that is not a hostname', async () => {
    const { llm } = fake([
      { domain: 'Rival Safaris Ltd', reason: 'A name, not a domain.' },
      { domain: '', reason: 'Empty.' },
      { domain: 'localhost', reason: 'No dot.' },
    ])

    expect(await suggestCompetitors(llm, 't', { url: SITE })).toEqual([])
  })

  it('tidies the reason: one line, no em dash, bounded', async () => {
    const { llm } = fake([
      {
        domain: 'rivalsafaris.com',
        reason: `Runs  safaris — mostly\nin the Mara. ${'x'.repeat(300)}`,
      },
    ])

    const [entry] = await suggestCompetitors(llm, 't', { url: SITE })

    expect(entry!.reason.startsWith('Runs safaris, mostly in the Mara.')).toBe(true)
    expect(entry!.reason).not.toContain('—')
    expect(entry!.reason.length).toBeLessThanOrEqual(160)
  })

  it('keeps at most the number it asked for', async () => {
    const { llm } = fake(
      Array.from({ length: 30 }, (_, i) => ({ domain: `rival${i}.example.com`, reason: 'x' })),
    )

    expect(await suggestCompetitors(llm, 't', { url: SITE })).toHaveLength(
      MAX_COMPETITOR_CANDIDATES,
    )
  })
})

describe('domainOf', () => {
  it.each([
    ['rival.com', 'rival.com'],
    ['  WWW.Rival.com  ', 'rival.com'],
    ['http://rival.co.ke/path', 'rival.co.ke'],
  ])('reads %j as %j', (raw, expected) => {
    expect(domainOf(raw)).toBe(expected)
  })

  it.each(['', 'rival', 'two words', 'http://'])('reads %j as nothing', (raw) => {
    expect(domainOf(raw)).toBeNull()
  })
})
