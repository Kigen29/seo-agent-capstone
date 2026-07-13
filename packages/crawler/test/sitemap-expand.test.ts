import { describe, expect, it, vi } from 'vitest'
import { expandSitemaps, type SitemapFetcher } from '../src/sitemap/expand.js'

const urlset = (...locs: string[]) =>
  `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`

const index = (...locs: string[]) =>
  `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`

/** A fetcher backed by a fixed map. Anything not in the map is a 404. */
const fetcherFor =
  (docs: Record<string, string>): SitemapFetcher =>
  async (url) =>
    docs[url]

describe('expandSitemaps', () => {
  it('follows an index down to the URLs', async () => {
    const fetcher = fetcherFor({
      'https://example.com/sitemap.xml': index(
        'https://example.com/pages.xml',
        'https://example.com/posts.xml',
      ),
      'https://example.com/pages.xml': urlset('https://example.com/', 'https://example.com/about'),
      'https://example.com/posts.xml': urlset('https://example.com/blog/1'),
    })

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher)

    expect(result.urls.map((u) => u.loc)).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/blog/1',
    ])
    expect(result.problems).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('survives an index that points at itself', async () => {
    // Without cycle detection this hangs forever, on a real site, in production.
    const fetcher = fetcherFor({
      'https://example.com/sitemap.xml': index('https://example.com/sitemap.xml'),
    })

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher)

    expect(result.visited).toEqual(['https://example.com/sitemap.xml'])
    expect(result.urls).toEqual([])
  })

  it('survives a cycle between two indexes', async () => {
    const fetcher = fetcherFor({
      'https://example.com/a.xml': index('https://example.com/b.xml'),
      'https://example.com/b.xml': index('https://example.com/a.xml'),
    })

    const result = await expandSitemaps(['https://example.com/a.xml'], fetcher)

    expect(result.visited).toHaveLength(2)
  })

  it('records a sitemap it could not fetch as a problem, not as an absence of URLs', async () => {
    const fetcher = fetcherFor({
      'https://example.com/sitemap.xml': index(
        'https://example.com/pages.xml',
        'https://example.com/gone.xml',
      ),
      'https://example.com/pages.xml': urlset('https://example.com/'),
    })

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher)

    expect(result.urls.map((u) => u.loc)).toEqual(['https://example.com/'])
    expect(result.problems).toEqual([
      { url: 'https://example.com/gone.xml', reason: 'Could not be fetched.' },
    ])
  })

  it('records an unparseable child without losing the URLs from its siblings', async () => {
    const fetcher = fetcherFor({
      'https://example.com/sitemap.xml': index(
        'https://example.com/broken.xml',
        'https://example.com/good.xml',
      ),
      'https://example.com/broken.xml': '<urlset><url><loc>oops',
      'https://example.com/good.xml': urlset('https://example.com/'),
    })

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher)

    expect(result.urls.map((u) => u.loc)).toEqual(['https://example.com/'])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]?.url).toBe('https://example.com/broken.xml')
  })

  it('does not let a thrown fetcher take the whole crawl down', async () => {
    const fetcher: SitemapFetcher = async (url) => {
      if (url.endsWith('boom.xml')) throw new Error('ECONNRESET')
      return index('https://example.com/boom.xml')
    }

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher)

    expect(result.problems[0]?.reason).toContain('ECONNRESET')
  })

  it('stops at maxDepth and says so, rather than silently returning half a site', async () => {
    const fetcher = fetcherFor({
      'https://example.com/1.xml': index('https://example.com/2.xml'),
      'https://example.com/2.xml': index('https://example.com/3.xml'),
      'https://example.com/3.xml': urlset('https://example.com/deep'),
    })

    const result = await expandSitemaps(['https://example.com/1.xml'], fetcher, { maxDepth: 1 })

    expect(result.urls).toEqual([])
    expect(result.truncated).toBe(true)
    expect(result.problems[0]?.reason).toContain('nested deeper than 1')
  })

  it('caps the number of documents fetched, so a hostile site cannot spin us forever', async () => {
    const children = Array.from({ length: 100 }, (_, i) => `https://example.com/s${i}.xml`)
    const docs: Record<string, string> = {
      'https://example.com/sitemap.xml': index(...children),
    }
    for (const child of children) docs[child] = urlset(`${child}/page`)

    const fetcher = vi.fn(fetcherFor(docs))

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher, {
      maxSitemaps: 5,
    })

    expect(result.truncated).toBe(true)
    expect(result.visited).toHaveLength(5)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('caps fetches even when every sitemap fails, because the cap counts attempts', async () => {
    // The cap must count fetch ATTEMPTS, not successes. Counting successes would let a
    // site whose sitemaps all 404 pull unlimited requests out of us while the visited
    // count stayed at zero, which is exactly the case the cap exists to prevent.
    const children = Array.from({ length: 100 }, (_, i) => `https://example.com/s${i}.xml`)
    const fetcher = vi.fn<SitemapFetcher>(async (url) =>
      url.endsWith('sitemap.xml') ? index(...children) : undefined,
    )

    const result = await expandSitemaps(['https://example.com/sitemap.xml'], fetcher, {
      maxSitemaps: 5,
    })

    expect(fetcher.mock.calls.length).toBe(5)
    expect(result.visited).toEqual(['https://example.com/sitemap.xml'])
    expect(result.truncated).toBe(true)
  })

  it('accepts several roots, because robots.txt may declare more than one sitemap', async () => {
    const fetcher = fetcherFor({
      'https://example.com/a.xml': urlset('https://example.com/a'),
      'https://example.com/b.xml': urlset('https://example.com/b'),
    })

    const result = await expandSitemaps(
      ['https://example.com/a.xml', 'https://example.com/b.xml'],
      fetcher,
    )

    expect(result.urls.map((u) => u.loc)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })
})
