import { describe, expect, it } from 'vitest'
import { checkCitation } from '../src/visibility/citation.js'
import { shareOfVoice } from '../src/visibility/stability.js'
import type { EngineAnswer, PollTarget } from '../src/visibility/types.js'

/**
 * The client and its competitors are looked for the same way (ADR-0041).
 *
 * After ADR-0040 the client was found in an answer by its name and a competitor only by its web
 * address. An answer that named both gave the client a citation and the competitor none, and the
 * share of voice built from that was the client's share of a contest only they had been entered
 * in.
 */
const said = (answer: string): EngineAnswer => ({
  engine: 'chatgpt',
  prompt: 'best safari company in nairobi',
  answer,
  citations: [],
})

const target: PollTarget = {
  domain: 'heartbeestsafaris.com',
  brand: 'Heartbeest Safaris',
  competitors: ['mufasatours.com', 'nameless.example', 'unread.example'],
  competitorNames: { 'mufasatours.com': 'Mufasa Tours', 'nameless.example': null },
}

describe('competitors named in an answer with no sources', () => {
  it('finds a competitor by its name, as it finds the client by theirs', () => {
    const check = checkCitation(
      said('Heartbeest Safaris and Mufasa Tours both run private trips from Nairobi.'),
      target,
    )

    expect(check.cited).toBe(true)
    // By address alone this was empty, and the client was credited with the whole answer.
    expect(check.citedCompetitors).toEqual(['mufasatours.com'])
  })

  it('gives the competitor the citation when only they are named', () => {
    const check = checkCitation(said('Most people book with Mufasa Tours.'), target)

    expect(check.cited).toBe(false)
    expect(check.citedCompetitors).toEqual(['mufasatours.com'])
  })

  it('holds a competitor to the same exact-name rule', () => {
    const check = checkCitation(said('Mufasa Travel and Tours Kenya is another option.'), target)

    expect(check.citedCompetitors).toEqual([])
  })

  it('falls back to the address for a competitor with no name, or one not read yet', () => {
    const check = checkCitation(said('See nameless.example, or try unread for a quote.'), target)

    expect(check.citedCompetitors).toEqual(['nameless.example', 'unread.example'])
  })

  it('makes share of voice a share of answers both sides could appear in', () => {
    const answers = [
      'Heartbeest Safaris and Mufasa Tours are the usual picks.',
      'Mufasa Tours is the best known.',
      'Mufasa Tours has the larger fleet.',
      'Heartbeest Safaris runs smaller groups.',
    ]
    const checks = answers.map((answer) => checkCitation(said(answer), target))
    const share = shareOfVoice(checks, target)

    // Two for the client, three for the competitor. Found by address only, the competitor had
    // none and the client's share read as all of it.
    expect(share.client).toBe(2)
    expect(share.competitors.find((entry) => entry.domain === 'mufasatours.com')?.citations).toBe(3)
    expect(share.clientShare).toBeCloseTo(2 / 5)
  })
})
