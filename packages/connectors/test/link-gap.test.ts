import { describe, expect, it } from 'vitest'
import { classifyGap, classifyGapDomain, linkGapFinding } from '../src/authority/link-gap.js'
import type { LinkGap, LinkGapDomain } from '../src/backlinks/types.js'

const domain = (over: Partial<LinkGapDomain> & { domain: string }): LinkGapDomain => ({
  intersections: 2,
  rank: 300,
  backlinks: 12,
  spamScore: 0,
  ...over,
})

const gapOf = (domains: LinkGapDomain[]): LinkGap => ({
  targets: ['rival-one.com', 'rival-two.com'],
  excluded: 'heartbeestsafaris.com',
  total: 120,
  domains,
  limit: 50,
})

describe('classifyGapDomain', () => {
  it('calls an ordinary publication editorial', () => {
    const classified = classifyGapDomain(domain({ domain: 'nation.africa' }))

    expect(classified.kind).toBe('editorial')
  })

  it('refuses a domain the vendor scores as spam', () => {
    // The first real query this seam ever made returned a page of link farms. Handing one to a
    // client as an opportunity is recommending a link scheme (CLAUDE.md rule 7).
    const classified = classifyGapDomain(domain({ domain: '60detiknewss.com', spamScore: 64 }))

    expect(classified.kind).toBe('spam')
    expect(classified.reason).toContain('64')
  })

  it('refuses a domain with no authority and thousands of links out', () => {
    const classified = classifyGapDomain(
      domain({ domain: 'linkfarm.example', rank: 0, backlinks: 19_132 }),
    )

    expect(classified.kind).toBe('spam')
  })

  it('does not refuse a small site merely for being small', () => {
    // Rank 0 with a handful of links is a new or tiny site, not a farm. Excluding it would quietly
    // drop exactly the local publications a small business can actually reach.
    const classified = classifyGapDomain(
      domain({ domain: 'localblog.co.ke', rank: 0, backlinks: 3 }),
    )

    expect(classified.kind).toBe('editorial')
  })

  it('routes a directory to the local axis rather than to outreach', () => {
    expect(classifyGapDomain(domain({ domain: 'yelp.com' })).kind).toBe('directory')
    expect(classifyGapDomain(domain({ domain: 'uk.trustpilot.com' })).kind).toBe('directory')
  })

  it('separates a platform anybody can post to from earned coverage', () => {
    expect(classifyGapDomain(domain({ domain: 'medium.com' })).kind).toBe('platform')
    expect(classifyGapDomain(domain({ domain: 'acme.wordpress.com' })).kind).toBe('platform')
  })

  it('lets spam win over the bucket a domain would otherwise fall in', () => {
    // A spammy directory is still spam. Classifying it as a citation would send a client to list
    // their business on it.
    expect(classifyGapDomain(domain({ domain: 'hotfrog.com', spamScore: 88 })).kind).toBe('spam')
  })
})

describe('linkGapFinding', () => {
  const editorial = [
    domain({ domain: 'nation.africa' }),
    domain({ domain: 'standardmedia.co.ke' }),
    domain({ domain: 'businessdailyafrica.com' }),
  ]

  const run = (domains: LinkGapDomain[]) => {
    const gap = gapOf(domains)
    return linkGapFinding({ siteId: 's1', gap, classified: classifyGap(gap) })
  }

  it('raises the editorial domains, named', () => {
    const [finding] = run(editorial)

    expect(finding?.ruleId).toBe('AUTH-005')
    expect(finding?.axis).toBe('authority')
    expect(finding?.fixable).toBe(false)
    expect(finding?.title).toContain('nation.africa')
  })

  it('counts only the editorial ones towards the threshold', () => {
    // Two publications, a directory and a platform is not three publications, and padding the
    // count with places nobody needs to pitch would make the finding fire on almost any site.
    const padded = [
      domain({ domain: 'nation.africa' }),
      domain({ domain: 'standardmedia.co.ke' }),
      domain({ domain: 'yelp.com' }),
      domain({ domain: 'medium.com' }),
    ]

    expect(run(padded)).toEqual([])
  })

  it('stays silent when nothing qualifies', () => {
    expect(run([])).toEqual([])
  })

  it('reports what it refused, rather than filtering silently', () => {
    // A filter nobody can see is a filter nobody can check.
    const withSpam = [...editorial, domain({ domain: 'farm.example', spamScore: 90 })]

    expect(run(withSpam)[0]?.falsification).toContain('1 domain(s) excluded as spam')
  })

  it('says the list is a slice of a larger set', () => {
    const [finding] = run(editorial)

    expect(finding?.falsification).toContain('top 50 of 120')
  })

  it('never suggests buying the links', () => {
    // The finding every other tool ships here is "you have too few backlinks", which sends a
    // client to a broker. This one names publications that already link to their rivals.
    const [finding] = run(editorial)

    expect(finding?.falsification).toMatch(/sell links/)
    expect(finding?.title).not.toMatch(/buy|purchase/i)
  })
})
