import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import {
  evaluateAuthority,
  MIN_UNLINKED_MENTIONS,
  type AuthorityReport,
} from '../src/authority/evaluate.js'
import { classifyMentions } from '../src/authority/mentions.js'
import type { ReferringDomains } from '../src/backlinks/types.js'
import type { SerpSource } from '../src/serp/types.js'

/**
 * AUTH-004, the one link-related finding on an axis that leads with mentions.
 *
 * Everything here is a pure function of two inputs, so it runs with no key, no network and no
 * spend. The property under test is the set difference: which domains wrote about the brand and
 * did not link to it.
 */

const CLIENT = 'https://heartbeestsafaris.com'
const src = (url: string): SerpSource => ({ url })

/** A mention footprint with `n` earned publishers, named predictably so links can be matched. */
const footprintOf = (publishers: string[]) =>
  classifyMentions(
    publishers.map((host) => src(`https://${host}/article`)),
    CLIENT,
  )

const linksFrom = (domains: string[], over: Partial<ReferringDomains> = {}): ReferringDomains => ({
  target: 'heartbeestsafaris.com',
  total: over.total ?? domains.length,
  domains: domains.map((domain) => ({ domain })),
  limit: over.limit ?? 100,
  ...over,
})

const evaluate = (publishers: string[], backlinks?: ReferringDomains) =>
  evaluateAuthority({
    siteId: 'site-1',
    brand: 'Heartbeest Safaris',
    footprint: footprintOf(publishers),
    competitors: [],
    ...(backlinks ? { backlinks } : {}),
    observedAt: '2026-08-02T00:00:00.000Z',
  })

const auth004 = (report: AuthorityReport): Finding | undefined =>
  report.findings.find((finding) => finding.ruleId === 'AUTH-004')

/** The finding, or a failure that says which finding was missing rather than "undefined". */
const requireAuth004 = (report: AuthorityReport): Finding => {
  const finding = auth004(report)
  if (!finding) throw new Error('expected an AUTH-004 finding, and there was none')
  return finding
}

describe('AUTH-004: mentions without links', () => {
  const publishers = [
    'nation.africa',
    'traveller.co.uk',
    'safaribooking.example',
    'timeout.example',
  ]

  it('finds the domains that wrote about the brand and did not link', () => {
    const report = evaluate(publishers, linksFrom(['nation.africa']))

    expect(report.unlinkedMentions).toEqual([
      'safaribooking.example',
      'timeout.example',
      'traveller.co.uk',
    ])
    expect(auth004(report)?.title).toContain('3 domain(s) mention')
  })

  it('raises nothing when every mentioning domain already links', () => {
    const report = evaluate(publishers, linksFrom(publishers))

    // An empty array, not undefined: we looked and found nothing to do, which is different from
    // never having looked.
    expect(report.unlinkedMentions).toEqual([])
    expect(auth004(report)).toBeUndefined()
  })

  it('says nothing at all when no backlink index is configured', () => {
    const report = evaluate(publishers)

    // Undefined rather than empty. The distinction is the whole honesty of the axis: we did not
    // look, which must not read as "everybody links".
    expect(report.unlinkedMentions).toBeUndefined()
    expect(auth004(report)).toBeUndefined()
  })

  it('stays quiet below the noise floor, because one unlinked mention is not a campaign', () => {
    const twoUnlinked = publishers.slice(0, 2)
    const report = evaluate(twoUnlinked, linksFrom([]))

    expect(report.unlinkedMentions).toHaveLength(2)
    expect(twoUnlinked.length).toBeLessThan(MIN_UNLINKED_MENTIONS)
    expect(auth004(report)).toBeUndefined()
  })

  it('treats a subdomain link as a link from the site', () => {
    // news.nation.africa linking is nation.africa linking. Counting it as unlinked would send a
    // client to ask for something they already have.
    const report = evaluate(publishers, linksFrom(['news.nation.africa']))

    expect(report.unlinkedMentions).not.toContain('nation.africa')
  })

  it('admits the truncation when the index is bigger than the slice we bought', () => {
    // The comparison is against the top N by authority. A link from outside that slice looks like
    // an absence, and a finding that did not say so would send someone to ask for a link they
    // already have.
    const report = evaluate(publishers, linksFrom(['nation.africa'], { total: 5000, limit: 100 }))

    const finding = requireAuth004(report)
    expect(finding.falsification).toContain('top 100')
    expect(finding.falsification).toContain('5000')
  })

  it('says the comparison was complete when it was', () => {
    const report = evaluate(publishers, linksFrom(['nation.africa'], { total: 1, limit: 100 }))

    expect(requireAuth004(report).falsification).toContain('not a truncation artefact')
  })

  it('carries the mentions-over-links research on the finding, not just in a comment', () => {
    const finding = requireAuth004(evaluate(publishers, linksFrom([])))

    expect(finding.falsification).toContain('0.664')
    expect(finding.falsification).toContain('0.218')
  })

  it('does not raise a "you have few backlinks" finding, however few there are', () => {
    // The finding every other tool leads with, and the one ADR-0018 rejects. A low link count is
    // reported as a number on the axis; it is never advice.
    const report = evaluate(['nation.africa'], linksFrom([], { total: 0 }))

    expect(report.findings.every((finding) => finding.ruleId !== 'AUTH-005')).toBe(true)
    expect(report.findings.map((finding) => finding.title).join(' ')).not.toMatch(/few .*backlink/i)
  })
})
