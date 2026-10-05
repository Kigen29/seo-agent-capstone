import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { earlierWorkOf, fingerprintAll, fingerprintOf } from '../src/fingerprint.js'

/**
 * A finding's identity across audits (ADR-0029). Pure functions: the database half is exercised
 * in `run.integration.test.ts`, where two real audits of one site have to recognise each other.
 */
const finding = (ruleId: string, title: string, urls: string[], subject?: string) => ({
  ruleId,
  title,
  affectedUrls: urls,
  ...(subject ? { subject } : {}),
})

describe('fingerprintOf', () => {
  it('is the rule and the first affected URL, which is what the migration backfills', () => {
    const expected = createHash('sha256').update('TECH-019|https://a.example/x').digest('hex')

    expect(
      fingerprintOf(finding('TECH-019', 't', ['https://a.example/x', 'https://a.example/y'])),
    ).toBe(expected)
  })

  it('does not change when the title or the later URLs do', () => {
    // The title carries counts ("34 pages share..."), and those move between audits.
    expect(fingerprintOf(finding('TECH-019', 'one', ['https://a.example/x']))).toBe(
      fingerprintOf(finding('TECH-019', 'two', ['https://a.example/x', 'https://a.example/z'])),
    )
  })

  it('tells two rules about one page apart, and one rule about two pages', () => {
    const base = fingerprintOf(finding('TECH-019', 't', ['https://a.example/x']))

    expect(fingerprintOf(finding('TECH-018', 't', ['https://a.example/x']))).not.toBe(base)
    expect(fingerprintOf(finding('TECH-019', 't', ['https://a.example/y']))).not.toBe(base)
  })

  it('follows the subject when a rule names one, whichever page is listed first', () => {
    // A duplicate title is about the title. The pages sharing it reorder from crawl to crawl.
    expect(fingerprintOf(finding('TECH-011', 't', ['https://a.example/x'], 'Shared title'))).toBe(
      fingerprintOf(finding('TECH-011', 't', ['https://a.example/y'], 'Shared title')),
    )
  })

  it('gives a site-level finding with no URL one identity per rule', () => {
    expect(fingerprintOf(finding('TECH-001', 'a', []))).toBe(
      fingerprintOf(finding('TECH-001', 'b', [])),
    )
  })
})

describe('fingerprintAll', () => {
  it('keeps two findings from one rule about one page distinct, in any input order', () => {
    const a = finding('TECH-015', 'insecure image a.png', ['https://a.example/x'])
    const b = finding('TECH-015', 'insecure script b.js', ['https://a.example/x'])

    const forward = fingerprintAll([a, b])
    const reversed = fingerprintAll([b, a])

    expect(forward.get(a)).not.toBe(forward.get(b))
    // Assigned by title, not by position, so the engine's ordering cannot swap them.
    expect(reversed.get(a)).toBe(forward.get(a))
    expect(reversed.get(b)).toBe(forward.get(b))
    // The first keeps the plain fingerprint, so the common case matches the backfill.
    expect(forward.get(a)).toBe(fingerprintOf(a))
  })
})

describe('earlierWorkOf', () => {
  it('names what earlier work on the same issue means', () => {
    expect(earlierWorkOf('pr_open')).toBe('in_progress')
    expect(earlierWorkOf('merged')).toBe('in_progress')
    expect(earlierWorkOf('verified')).toBe('regressed')
    expect(earlierWorkOf('rejected')).toBe('fix_failed')
    // Still there, or deliberately left: neither is "work" to point at.
    expect(earlierWorkOf('open')).toBeNull()
    expect(earlierWorkOf('wontfix')).toBeNull()
  })
})
