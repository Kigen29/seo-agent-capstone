import { describe, expect, it, vi } from 'vitest'
import { findContributors } from '../src/authority/contributors.js'
import { classifyContributorPage, contributorQueries } from '../src/authority/link-sellers.js'
import type { SerpProvider } from '../src/serp/types.js'

/**
 * The filter is the feature.
 *
 * A search for `"tiles" "write for us"` returns sellers next to publications, because sellers
 * optimise for exactly that phrase. Shipping the raw list is recommending a link scheme, which
 * rule 7 forbids, so these tests are mostly about what gets refused and why.
 */

describe('classifyContributorPage', () => {
  it('reads a genuine guidelines page as inviting', () => {
    const page = `<h1>Write for us</h1><p>We accept pitches from people working in the trade.
      Read our submission guidelines before sending an idea.</p>`

    expect(classifyContributorPage(page)).toMatchObject({ verdict: 'inviting' })
  })

  it('refuses a page that quotes a price for a post', () => {
    const page = '<h1>Write for us</h1><p>Guest post price: $80 per article, dofollow link.</p>'

    const read = classifyContributorPage(page)
    expect(read.verdict).toBe('selling')
    expect(read.matched.length).toBeGreaterThan(0)
  })

  it('lets selling beat inviting whenever both appear', () => {
    // The property that makes the filter worth having. Nearly every seller also says "write for
    // us", because that is the phrase their customers search for, so an inviting-wins rule would
    // pass almost all of them.
    const page = `<h1>Write for us</h1><p>We welcome contributors.</p>
      <h2>Sponsored post</h2><p>Our rates start at $120.</p>`

    expect(classifyContributorPage(page).verdict).toBe('selling')
  })

  it('catches a price quoted near a contribution offer even with no known phrase', () => {
    const page = '<p>Publish your article with us for $200 USD, permanent placement.</p>'

    expect(classifyContributorPage(page).verdict).toBe('selling')
  })

  it('does not condemn a shop for having prices on the page', () => {
    // A tile retailer's own price list is not a link seller. The signals are phrases a paid-link
    // page uses about itself, not the mere presence of money.
    const page = '<h1>Floor tiles</h1><p>From KSh 1,200 per square metre. Free delivery.</p>'

    expect(classifyContributorPage(page).verdict).toBe('neither')
  })

  it('reads the visible text, not the markup', () => {
    // A class name like "sponsored-posts" in a template must not condemn a page whose visible
    // words never mention money.
    const page =
      '<div class="sponsored-post-widget"><h1>Write for us</h1><p>Send a pitch.</p></div>'

    expect(classifyContributorPage(page).verdict).toBe('inviting')
  })

  it('calls a page that offers neither thing neither', () => {
    expect(classifyContributorPage('<h1>About us</h1><p>We sell tiles.</p>').verdict).toBe(
      'neither',
    )
  })
})

describe('contributorQueries', () => {
  it('quotes the niche and includes the market when given one', () => {
    const queries = contributorQueries('floor tiles', 'Kenya')

    expect(queries[0]).toBe('"floor tiles" Kenya "write for us"')
    expect(queries).toHaveLength(3)
  })

  it('never searches for sellers in order to exclude them', () => {
    // Spending a client's money to build a list we intend to throw away. The page-level filter
    // catches sellers when they appear in the honest queries, which they do.
    const queries = contributorQueries('floor tiles')

    expect(queries.join(' ')).not.toMatch(/paid|sponsored|buy/i)
  })
})

describe('findContributors', () => {
  const source = (url: string, title: string, snippet = '') => ({ url, title, snippet })

  const provider = (sources: { url: string; title: string; snippet?: string }[]): SerpProvider => ({
    name: 'fake-serp',
    aiOverview: async (query) => ({ query, text: '', sources: [], present: false }),
    mentions: async (query) => ({ query, sources }),
    relatedQuestions: async (query) => ({ query, questions: [] }),
  })

  /** A fetch that answers each candidate URL with a page body chosen by the test. */
  const pages = (bodies: Record<string, string>) =>
    ({
      fetch: vi.fn(async (input: string) => new Response(bodies[input] ?? '', { status: 200 })),
      resolve: (async () => [{ address: '93.184.216.34', family: 4 }]) as never,
    }) as never

  it('keeps the publications and names the sellers it refused', async () => {
    const serp = provider([
      source('https://trade-journal.test/write-for-us', 'Write for us — tiles'),
      source('https://linkshop.test/guest-posts', 'Guest posts'),
    ])

    const result = await findContributors(serp, {
      niche: 'floor tiles',
      maxQueries: 1,
      fetchOptions: pages({
        'https://trade-journal.test/write-for-us':
          '<h1>Write for us</h1><p>We take pitches from the trade.</p>',
        'https://linkshop.test/guest-posts':
          '<h1>Write for us</h1><p>Guest post price: $80, dofollow link.</p>',
      }),
    })

    expect(result.opportunities.map((entry) => entry.domain)).toEqual(['trade-journal.test'])
    // Named, not dropped: the exclusion is the part a client should be able to audit.
    expect(result.refused.map((entry) => entry.domain)).toEqual(['linkshop.test'])
  })

  it('leaves out a page it could not read at all', async () => {
    // Recommending a site we could not open is recommending a site we have not checked.
    const serp = provider([source('https://unreachable.test/contribute', 'Contribute')])

    const result = await findContributors(serp, {
      niche: 'tiles',
      maxQueries: 1,
      fetchOptions: {
        fetch: (async () => {
          throw new Error('connection refused')
        }) as never,
        resolve: (async () => [{ address: '93.184.216.34', family: 4 }]) as never,
      },
    })

    expect(result.opportunities).toEqual([])
    expect(result.refused).toEqual([])
  })

  it('never offers the client their own site', async () => {
    const serp = provider([source('https://rangautiles.com/write-for-us', 'Write for us')])

    const result = await findContributors(serp, {
      niche: 'tiles',
      clientDomain: 'rangautiles.com',
      maxQueries: 1,
      fetchOptions: pages({
        'https://rangautiles.com/write-for-us': '<h1>Write for us</h1><p>Pitch us.</p>',
      }),
    })

    expect(result.opportunities).toEqual([])
  })

  it('counts one publication once, however many of its pages match', async () => {
    const serp = provider([
      source('https://journal.test/write-for-us', 'Write for us'),
      source('https://journal.test/contribute', 'Contribute'),
    ])

    const result = await findContributors(serp, {
      niche: 'tiles',
      maxQueries: 1,
      fetchOptions: pages({
        'https://journal.test/write-for-us': '<h1>Write for us</h1><p>Pitch us.</p>',
      }),
    })

    expect(result.opportunities).toHaveLength(1)
  })

  it('reports how many billed queries it ran', async () => {
    const serp = provider([source('https://journal.test/write-for-us', 'Write for us')])

    const result = await findContributors(serp, {
      niche: 'tiles',
      maxQueries: 3,
      fetchOptions: pages({
        'https://journal.test/write-for-us': '<h1>Write for us</h1><p>Pitch us.</p>',
      }),
    })

    expect(result.queriesRun).toBe(3)
  })

  it('survives a failed query rather than losing the whole search', async () => {
    let call = 0
    const serp: SerpProvider = {
      name: 'fake-serp',
      aiOverview: async (query) => ({ query, text: '', sources: [], present: false }),
      relatedQuestions: async (query) => ({ query, questions: [] }),
      mentions: async (query) => {
        call += 1
        if (call === 1) throw new Error('vendor down')
        return { query, sources: [source('https://journal.test/write-for-us', 'Write for us')] }
      },
    }

    const result = await findContributors(serp, {
      niche: 'tiles',
      maxQueries: 2,
      fetchOptions: pages({
        'https://journal.test/write-for-us': '<h1>Write for us</h1><p>Pitch us.</p>',
      }),
    })

    expect(result.opportunities).toHaveLength(1)
    expect(result.queriesRun).toBe(1)
  })
})
