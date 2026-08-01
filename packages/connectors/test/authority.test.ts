import { describe, expect, it } from 'vitest'
import { evaluateAuthority, THIN_FOOTPRINT } from '../src/authority/evaluate.js'
import { classifyMentions, mentionQuery } from '../src/authority/mentions.js'
import type { SerpSource } from '../src/serp/types.js'

const CLIENT = 'https://heartbeestsafaris.com'

const src = (url: string): SerpSource => ({ url })

describe('mentionQuery', () => {
  it('quotes the brand and excludes the client site, so the result is earned by construction', () => {
    // Unquoted, "Heartbeest Safaris" would match any page containing "safaris". Without the
    // exclusion, their own site would dominate the first page of results for their own name, and
    // we would be paying for results we intend to discard.
    expect(mentionQuery('Heartbeest Safaris', CLIENT)).toBe(
      '"Heartbeest Safaris" -site:heartbeestsafaris.com',
    )
  })

  it('strips quotes out of the brand so the operator cannot be broken', () => {
    expect(mentionQuery('The "Best" Safaris', CLIENT)).toContain('"The Best Safaris"')
  })
})

describe('classifyMentions', () => {
  it('separates earned coverage from platforms a brand can post to itself', () => {
    const footprint = classifyMentions(
      [
        src('https://nation.africa/travel/safari-review'),
        src('https://www.linkedin.com/posts/heartbeest-activity'),
        src('https://heartbeestsafaris.com/about'),
        src('https://traveller.co.uk/kenya-operators'),
      ],
      CLIENT,
    )

    // Counting these together would let a busy social calendar read as authority.
    expect(footprint.earnedDomains).toEqual(['nation.africa', 'traveller.co.uk'])
    expect(footprint.selfPublishedDomains).toEqual(['linkedin.com'])
    expect(footprint.ownedDomains).toEqual(['heartbeestsafaris.com'])
  })

  it('counts a publication once however many of its pages appear', () => {
    const footprint = classifyMentions(
      [
        src('https://nation.africa/a'),
        src('https://nation.africa/b'),
        src('https://nation.africa/c'),
      ],
      CLIENT,
    )

    // Ten pages on one news site is one publication that covered you. Counting results would
    // make a single press release look like a campaign.
    expect(footprint.earnedDomains).toEqual(['nation.africa'])
  })

  it('treats a subdomain of a publishing platform as self-published', () => {
    const footprint = classifyMentions([src('https://heartbeest.wordpress.com/post')], CLIENT)
    expect(footprint.selfPublishedDomains).toEqual(['heartbeest.wordpress.com'])
    expect(footprint.earnedDomains).toEqual([])
  })

  it('treats a subdomain of the client as owned, not earned', () => {
    const footprint = classifyMentions([src('https://blog.heartbeestsafaris.com/x')], CLIENT)
    expect(footprint.ownedDomains).toHaveLength(1)
    expect(footprint.earnedDomains).toEqual([])
  })

  it('skips a source whose URL cannot be read rather than counting it as a domain', () => {
    const footprint = classifyMentions([src('not a url'), src('https://nation.africa/a')], CLIENT)
    expect(footprint.earnedDomains).toEqual(['nation.africa'])
  })
})

describe('evaluateAuthority', () => {
  const footprint = (earned: number, self = 0) =>
    classifyMentions(
      [
        ...Array.from({ length: earned }, (_, i) => src(`https://publisher${i}.example/a`)),
        ...Array.from({ length: self }, (_, i) =>
          src(`https://${['linkedin.com', 'facebook.com', 'x.com', 'reddit.com'][i]!}/a`),
        ),
      ],
      CLIENT,
    )

  const evaluate = (
    earned: number,
    self = 0,
    competitors: { domain: string; earnedDomains: number }[] = [],
  ) =>
    evaluateAuthority({
      siteId: 'site-1',
      brand: 'Heartbeest Safaris',
      footprint: footprint(earned, self),
      competitors,
      observedAt: '2026-08-02T00:00:00.000Z',
    })

  it('raises nothing for a healthy, mostly-earned footprint with no rival ahead', () => {
    expect(evaluate(8, 1).findings).toEqual([])
  })

  it('leads with the competitive loss when a rival is mentioned more widely', () => {
    const report = evaluate(8, 0, [
      { domain: 'rivalsafaris.com', earnedDomains: 20 },
      { domain: 'anothertour.co.ke', earnedDomains: 3 },
    ])

    const finding = report.findings[0]!
    expect(finding.ruleId).toBe('AUTH-001')
    expect(finding.severity).toBe('high')
    // The rival who is furthest ahead, not just any rival ahead.
    expect(finding.title).toContain('rivalsafaris.com')
    expect(finding.title).toContain('20 earned-media domains to your 8')
  })

  it('flags a thin footprint below the bar', () => {
    const report = evaluate(THIN_FOOTPRINT - 1)
    const thin = report.findings.find((f) => f.ruleId === 'AUTH-002')

    expect(thin?.severity).toBe('medium')
    expect(thin?.falsification).toContain('0.664')
    expect(thin?.falsification).toContain('0.218')
  })

  it('says so when the footprint is mostly the brand talking about itself', () => {
    const report = evaluate(2, 4)
    const self = report.findings.find((f) => f.ruleId === 'AUTH-003')

    expect(self?.severity).toBe('low')
    expect(self?.title).toContain('post to yourself')
  })

  it('does not pile the self-published finding onto a brand nobody mentions at all', () => {
    // With no earned coverage, AUTH-002 already says the useful thing. AUTH-003 on top would say
    // it again, worse.
    const report = evaluate(0, 3)
    expect(report.findings.map((f) => f.ruleId)).toEqual(['AUTH-002'])
  })

  it('never presents backlinks as the authority signal', () => {
    const report = evaluate(1, 0, [{ domain: 'rivalsafaris.com', earnedDomains: 9 }])

    // The axis's falsification is the honesty check: every finding grounds itself in the mention
    // research, and none of them tells a client to go and buy links.
    for (const finding of report.findings) {
      expect(finding.falsification).toContain(
        'mention-building and link-building are two different jobs',
      )
      expect(finding.evidence).toMatchObject({ source: 'serp' })
    }
  })

  it('reports every finding as needing a human, because outreach is not a diff', () => {
    const report = evaluate(1, 0, [{ domain: 'rivalsafaris.com', earnedDomains: 9 }])
    expect(report.findings.every((f) => !f.fixable)).toBe(true)
  })
})
