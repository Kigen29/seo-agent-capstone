import { describe, expect, it } from 'vitest'
import { mobileSample } from '../src/crawl/mobile.js'
import type { CrawledPage } from '../src/crawl/types.js'
import { extractPage } from '../src/page/extract.js'
import { compareRenders } from '../src/page/render.js'

/**
 * Which pages get the second, phone-width render. The render itself is exercised against a live
 * page in `crawler.integration.test.ts`; this is the choice of sample, which has to be the same
 * on every crawl or a finding would appear and vanish with the order pages were fetched in.
 */
const page = (path: string, depth: number, overrides: Partial<CrawledPage> = {}): CrawledPage => {
  const url = `https://shop.example${path}`
  const html = '<html><body><p>words</p></body></html>'
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: {},
    redirectChain: [],
    depth,
    fetchedAt: '2026-10-05T00:00:00.000Z',
    preJsHtml: html,
    renderedHtml: html,
    extract: extractPage(html, url),
    render: compareRenders(html, html, url),
    ...overrides,
  }
}

const paths = (pages: CrawledPage[]) => pages.map((p) => new URL(p.finalUrl).pathname)

describe('mobileSample', () => {
  const pages = [
    page('/deep/page', 2),
    page('/prices', 1),
    page('/', 0),
    page('/about', 1),
    page('/gone', 1, { status: 404 }),
    page('/timeout', 1, { error: 'Timeout', renderedHtml: '' }),
  ]

  it('takes the shallowest pages first, the homepage before everything', () => {
    expect(paths(mobileSample(pages, 3))).toEqual(['/', '/about', '/prices'])
  })

  it('is the same sample whatever order the crawl fetched pages in', () => {
    expect(paths(mobileSample([...pages].reverse(), 3))).toEqual(paths(mobileSample(pages, 3)))
  })

  it('skips pages that did not load, and never renders one page twice', () => {
    const withDuplicate = [...pages, page('/about', 1)]

    expect(paths(mobileSample(withDuplicate, 50))).toEqual(['/', '/about', '/prices', '/deep/page'])
  })

  it('renders nothing when the sample size is zero', () => {
    expect(mobileSample(pages, 0)).toEqual([])
  })
})
