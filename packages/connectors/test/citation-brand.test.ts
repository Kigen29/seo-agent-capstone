import { describe, expect, it } from 'vitest'
import { containsName } from '../src/text/name-match.js'
import { checkCitation } from '../src/visibility/citation.js'
import type { EngineAnswer, PollTarget } from '../src/visibility/types.js'

/**
 * An AI answer that names the business, from an engine that gives no source list.
 *
 * The mirror image of the mention fault (ADR-0039). There a search engine's guess was taken as
 * a mention of the client. Here the opposite: an assistant saying "Heartbeest Safaris" in plain
 * words was read as not mentioning the client, because only the web address was looked for.
 */
const said = (answer: string, citations: string[] = []): EngineAnswer => ({
  engine: 'chatgpt',
  prompt: 'best safari company in nairobi',
  answer,
  citations,
})

const named: PollTarget = {
  domain: 'heartbeestsafaris.com',
  competitors: ['rivalsafaris.com'],
  brand: 'Heartbeest Safaris',
}

describe('an answer with no sources, for a client whose name is known', () => {
  it('counts an answer that names the business in ordinary words', () => {
    const check = checkCitation(
      said('For private trips from Nairobi, Heartbeest Safaris is a good choice.'),
      named,
    )

    // Looking only for "heartbeestsafaris" reported this as silence.
    expect(check.cited).toBe(true)
    expect(check.basis).toBe('mention')
  })

  it('still counts an answer that gives the web address', () => {
    expect(checkCitation(said('See heartbeestsafaris.com for dates.'), named).cited).toBe(true)
  })

  it('does not count a similarly named business', () => {
    const check = checkCitation(
      said('African Hartebeest Safaris Limited runs northern circuit tours.'),
      named,
    )

    expect(check.cited).toBe(false)
  })

  it('does not count part of the name, or the name inside a longer word', () => {
    expect(checkCitation(said('The hartebeest and heartbeest are antelopes.'), named).cited).toBe(
      false,
    )
    expect(checkCitation(said('Try Heartbeest Safarisland.'), named).cited).toBe(false)
  })

  it('does not let a common word in the address stand in for the business', () => {
    const tiles: PollTarget = {
      domain: 'tiles.co.ke',
      competitors: [],
      brand: 'Tiles and More Kenya',
    }

    // The address squashed to a word is "tiles", which any answer about tiles contains.
    expect(
      checkCitation(said('Ceramic tiles are cheaper than porcelain tiles.'), tiles).cited,
    ).toBe(false)
    expect(checkCitation(said('Tiles and More Kenya stocks both.'), tiles).cited).toBe(true)
  })

  it('lets real sources overrule the words, as before', () => {
    const check = checkCitation(
      said('Heartbeest Safaris is popular.', ['https://rivalsafaris.com/']),
      named,
    )

    expect(check.cited).toBe(false)
    expect(check.basis).toBe('citations')
  })

  it("does not use the client's name to decide whether a competitor was mentioned", () => {
    const check = checkCitation(said('Heartbeest Safaris is a good choice.'), named)

    expect(check.citedCompetitors).toEqual([])
  })
})

describe('an answer with no sources, for a client with no name set', () => {
  it('falls back to the address, exactly as it did', () => {
    const unnamed: PollTarget = { domain: 'heartbeestsafaris.com', competitors: [] }

    expect(checkCitation(said('Try heartbeestsafaris.com.'), unnamed).cited).toBe(true)
    expect(checkCitation(said('Try heartbeestsafaris for trips.'), unnamed).cited).toBe(true)
    // Two words are not the squashed address. Setting the brand name is what fixes this.
    expect(checkCitation(said('Try Heartbeest Safaris.'), unnamed).cited).toBe(false)
  })

  it('treats a blank name as no name', () => {
    const blank: PollTarget = { domain: 'heartbeestsafaris.com', competitors: [], brand: '   ' }

    expect(checkCitation(said('Try heartbeestsafaris for trips.'), blank).cited).toBe(true)
  })
})

describe('containsName', () => {
  it('ignores capitals, punctuation, spacing and accents', () => {
    expect(containsName('HEARTBEEST-SAFARIS, reviewed', 'Heartbeest Safaris')).toBe(true)
    expect(containsName('Café  Zoë opens', 'Cafe Zoe')).toBe(true)
  })

  it('never finds an empty name, or anything in empty text', () => {
    expect(containsName('anything at all', '')).toBe(false)
    expect(containsName('anything at all', ' - ')).toBe(false)
    expect(containsName('', 'Heartbeest Safaris')).toBe(false)
    expect(containsName(undefined, 'Heartbeest Safaris')).toBe(false)
  })
})
