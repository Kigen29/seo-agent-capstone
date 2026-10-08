import type { AuthorityMetrics } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { applyMentionExclusions, withoutExcludedSources } from '../src/authority/exclusions.js'

/**
 * Sites the client has said are not about them (ADR-0042).
 *
 * The exact-name check cannot tell two businesses with the same name apart. This is the client
 * telling us, and what is checked is that their word is applied fully and to nothing else: the
 * site goes from every figure and list it was in, and no other site is touched.
 */
const measured: AuthorityMetrics = {
  referringDomains: 84,
  earnedDomains: 3,
  selfPublishedDomains: 1,
  unlinkedMentions: ['same-name.example', 'real-press.example'],
  mentions: [
    {
      url: 'https://real-press.example/a',
      domain: 'real-press.example',
      kind: 'earned',
      linked: false,
    },
    {
      url: 'https://same-name.example/tours',
      domain: 'same-name.example',
      kind: 'earned',
      linked: false,
    },
    {
      url: 'https://same-name.example/about',
      domain: 'same-name.example',
      kind: 'earned',
      linked: false,
    },
    { url: 'https://linked.example/b', domain: 'linked.example', kind: 'earned', linked: true },
    { url: 'https://facebook.com/page', domain: 'facebook.com', kind: 'self_published' },
  ],
}

describe('applyMentionExclusions', () => {
  it('takes an excluded site out of the count, the pages and the outreach list', () => {
    const result = applyMentionExclusions(measured, ['same-name.example'])

    // One site fewer, however many of its pages were listed.
    expect(result.earnedDomains).toBe(2)
    expect(result.mentions?.map((mention) => mention.domain)).toEqual([
      'real-press.example',
      'linked.example',
      'facebook.com',
    ])
    expect(result.unlinkedMentions).toEqual(['real-press.example'])
  })

  it('touches nothing else', () => {
    const result = applyMentionExclusions(measured, ['same-name.example'])

    expect(result.referringDomains).toBe(84)
    expect(result.selfPublishedDomains).toBe(1)
  })

  it('lowers the platform count when the excluded site is a platform profile', () => {
    const result = applyMentionExclusions(measured, ['facebook.com'])

    expect(result.selfPublishedDomains).toBe(0)
    expect(result.earnedDomains).toBe(3)
  })

  it('excludes a site together with its subdomains', () => {
    const blog: AuthorityMetrics = {
      ...measured,
      mentions: [
        {
          url: 'https://blog.same-name.example/x',
          domain: 'blog.same-name.example',
          kind: 'earned',
        },
      ],
      earnedDomains: 1,
    }

    expect(applyMentionExclusions(blog, ['same-name.example']).mentions).toEqual([])
  })

  it('lowers the count by the sites removed, and does not recount from a capped list', () => {
    // Forty sites were counted; the page list holds only some of them.
    const large: AuthorityMetrics = { ...measured, earnedDomains: 40 }

    expect(applyMentionExclusions(large, ['same-name.example']).earnedDomains).toBe(39)
  })

  it('leaves an unmeasured count unmeasured, never zero', () => {
    const unmeasured: AuthorityMetrics = { ...measured, earnedDomains: null }

    expect(applyMentionExclusions(unmeasured, ['same-name.example']).earnedDomains).toBeNull()
  })

  it('does nothing with an empty list, or for a site that was never mentioned', () => {
    expect(applyMentionExclusions(measured, [])).toBe(measured)
    expect(applyMentionExclusions(measured, ['elsewhere.example'])).toBe(measured)
  })

  it('returns an audit that kept no page list as it is', () => {
    const old: AuthorityMetrics = {
      referringDomains: 84,
      earnedDomains: 6,
      selfPublishedDomains: 1,
    }

    // Nothing to work from. The exclusion applies when the site is next audited.
    expect(applyMentionExclusions(old, ['same-name.example'])).toBe(old)
  })

  it('undoing an exclusion brings the site back, because the stored audit was never changed', () => {
    applyMentionExclusions(measured, ['same-name.example'])

    expect(applyMentionExclusions(measured, []).earnedDomains).toBe(3)
    expect(measured.mentions).toHaveLength(5)
  })
})

describe('withoutExcludedSources', () => {
  const sources = [
    { url: 'https://real-press.example/a' },
    { url: 'https://www.same-name.example/tours' },
    { url: 'not a url' },
  ]

  it('drops results on an excluded site before anything is counted', () => {
    expect(withoutExcludedSources(sources, ['same-name.example']).map((s) => s.url)).toEqual([
      'https://real-press.example/a',
      'not a url',
    ])
  })

  it('returns everything when nothing is excluded', () => {
    expect(withoutExcludedSources(sources, [])).toEqual(sources)
  })
})
