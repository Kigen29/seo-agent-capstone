import { describe, expect, it } from 'vitest'
import { checkCitation, hostOf, sameSite } from '../src/visibility/citation.js'
import type { EngineAnswer, PollTarget } from '../src/visibility/types.js'

const answer = (over: Partial<EngineAnswer> = {}): EngineAnswer => ({
  engine: 'perplexity',
  prompt: 'best safari company in nairobi',
  answer: 'Several operators run safaris from Nairobi.',
  citations: [],
  ...over,
})

const target: PollTarget = {
  domain: 'heartbeestsafaris.com',
  competitors: ['rivalsafaris.com', 'anothertour.co.ke'],
}

describe('hostOf and sameSite', () => {
  it('normalises hosts, stripping scheme and www', () => {
    expect(hostOf('https://www.Example.com/path')).toBe('example.com')
    expect(hostOf('example.com')).toBe('example.com')
    expect(hostOf('not a url')).toBeNull()
  })

  it('treats a subdomain as the same site, and rejects look-alikes', () => {
    expect(sameSite('https://blog.example.com/x', 'example.com')).toBe(true)
    expect(sameSite('www.example.com', 'https://example.com/')).toBe(true)
    expect(sameSite('example.com.evil.test', 'example.com')).toBe(false)
    expect(sameSite('notexample.com', 'example.com')).toBe(false)
  })
})

describe('checkCitation', () => {
  it('marks the client cited when a cited source is on their domain', () => {
    const check = checkCitation(
      answer({
        citations: ['https://www.heartbeestsafaris.com/tours', 'https://rivalsafaris.com/'],
      }),
      target,
    )
    expect(check.cited).toBe(true)
    expect(check.basis).toBe('citations')
    expect(check.citedCompetitors).toEqual(['rivalsafaris.com'])
  })

  it('does not mark the client cited when only competitors are in the sources', () => {
    const check = checkCitation(
      answer({ citations: ['https://rivalsafaris.com/', 'https://anothertour.co.ke/x'] }),
      target,
    )
    expect(check.cited).toBe(false)
    expect(check.citedCompetitors).toEqual(['rivalsafaris.com', 'anothertour.co.ke'])
  })

  it('falls back to a text mention only when the engine gave no sources', () => {
    // A chat engine that cites nothing but names the domain in its answer. The mention basis is
    // weaker than a real citation, and matches the domain or its exact stem token, not a spaced
    // brand name, which is why it is recorded as `mention` for the caller to weight down.
    const check = checkCitation(
      answer({
        engine: 'chatgpt',
        answer: 'A well-known operator in Nairobi is heartbeestsafaris.com.',
        citations: [],
      }),
      target,
    )
    expect(check.cited).toBe(true)
    expect(check.basis).toBe('mention')
  })

  it('does not fall back to a mention when sources are present but exclude the client', () => {
    // The answer text names the client, but the engine cited someone else; the sources win.
    const check = checkCitation(
      answer({
        answer: 'Heartbeest Safaris is popular, but here is a rival.',
        citations: ['https://rivalsafaris.com/'],
      }),
      target,
    )
    expect(check.cited).toBe(false)
    expect(check.basis).toBe('citations')
  })

  it('does not mention-match a stem inside a longer word', () => {
    const check = checkCitation(
      answer({
        engine: 'chatgpt',
        answer: 'heartbeestsafarisworldwide is unrelated',
        citations: [],
      }),
      { domain: 'heartbeest.com', competitors: [] },
    )
    expect(check.cited).toBe(false)
  })
})
