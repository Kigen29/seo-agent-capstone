import type { BacklinkProvider, SerpProvider } from '@seo/connectors'
import { describe, expect, it } from 'vitest'
import { measureAuthority } from '../src/authority.js'

/**
 * The authority axis with each of its two paid sources present or absent.
 *
 * Written after a real audit: DataForSEO was configured and paid for, SerpApi was not, and the
 * axis stopped at the missing mention source and then said no backlink index was configured.
 * Links must be measured whenever an index exists; they must not carry the score on their own.
 */

const options = {
  siteId: 'site-1',
  brand: 'Heartbeest Safaris',
  domain: 'heartbeestsafaris.com',
  competitors: [] as string[],
}

const backlinks: BacklinkProvider = {
  name: 'fake-links',
  referringDomains: async (domain) => ({
    target: domain,
    total: 42,
    domains: [{ domain: 'travel.example' }, { domain: 'news.example' }],
    limit: 100,
  }),
  intersection: async (targets, exclude) => ({
    targets: [...targets],
    excluded: exclude,
    total: 0,
    domains: [],
    limit: 100,
  }),
}

const serp = {
  name: 'fake-serp',
  mentions: async (query: string) => ({ query, sources: [] }),
} as unknown as SerpProvider

describe('measureAuthority', () => {
  it('measures links with no mention source, and leaves the axis unscored', async () => {
    const result = await measureAuthority(options, undefined, backlinks)

    expect(result.metrics).toMatchObject({
      referringDomains: 42,
      referringDomainsSampled: 2,
      earnedDomains: null,
      selfPublishedDomains: null,
    })
    // Zero checks is what keeps the scorecard at a dash: links are the second signal, not the lead.
    expect(result.coverage.checksRun).toBe(0)
    expect(result.coverage.note).toMatch(/42 domain\(s\) link to heartbeestsafaris\.com/)
    expect(result.coverage.note).toMatch(/SERPAPI_API_KEY/)
    expect(result.coverage.note).not.toMatch(/no backlink index is configured/)
  })

  it('keeps the pages that mention the brand, and says which sites do not link', async () => {
    const mentioned = {
      name: 'fake-serp',
      mentions: async (query: string) => ({
        query,
        sources: [
          { url: 'https://travel.example/story', title: 'A story about Heartbeest' },
          { url: 'https://unlinked.example/review', title: 'A review' },
          { url: 'https://heartbeestsafaris.com/about', title: 'About us' },
        ],
      }),
    } as unknown as SerpProvider

    const result = await measureAuthority(options, mentioned, backlinks)

    // The count used to be all that survived. The pages are what make it checkable.
    expect(result.metrics?.earnedDomains).toBe(2)
    expect(result.metrics?.mentions).toEqual([
      {
        url: 'https://travel.example/story',
        domain: 'travel.example',
        title: 'A story about Heartbeest',
        kind: 'earned',
        linked: true,
      },
      {
        url: 'https://unlinked.example/review',
        domain: 'unlinked.example',
        title: 'A review',
        kind: 'earned',
        linked: false,
      },
    ])
  })

  it('measures links when the brand is not set yet', async () => {
    const result = await measureAuthority({ ...options, brand: null }, serp, backlinks)

    expect(result.metrics?.referringDomains).toBe(42)
    expect(result.coverage.note).toMatch(/Set the brand name/)
  })

  it('says links did not answer when the index fails, rather than claiming it is missing', async () => {
    const failing: BacklinkProvider = {
      ...backlinks,
      referringDomains: async () => {
        throw new Error('vendor down')
      },
    }
    const result = await measureAuthority(options, undefined, failing)

    expect(result.metrics).toBeUndefined()
    expect(result.coverage.note).toMatch(/did not answer/)
  })

  it('still says no backlink index is configured when there genuinely is none', async () => {
    const result = await measureAuthority(options, undefined, undefined)

    expect(result.metrics).toBeUndefined()
    expect(result.coverage.checksRun).toBe(0)
    expect(result.coverage.note).toMatch(/no backlink index is configured/)
  })

  it('scores the axis once mentions are measured, with links as the second signal', async () => {
    const result = await measureAuthority(options, serp, backlinks)

    expect(result.measured).toBe(true)
    expect(result.coverage.checksRun).toBeGreaterThan(0)
    expect(result.metrics).toMatchObject({ referringDomains: 42, earnedDomains: 0 })
  })
})
