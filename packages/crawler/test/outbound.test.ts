import type { BrowserContext } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { checkOutboundLinks, outboundCandidates } from '../src/crawl/outbound.js'
import type { CrawledPage } from '../src/crawl/types.js'
import { extractPage } from '../src/page/extract.js'
import { compareRenders } from '../src/page/render.js'

/**
 * The parts of the outbound check that must hold without a network: which links are candidates,
 * and that the egress guard is asked before anything is fetched. What real servers answer is
 * covered against a live one in `crawler.integration.test.ts`.
 */
const page = (url: string, links: string[], status = 200): CrawledPage => {
  const html = `<html><body>${links.map((href) => `<a href="${href}">a link</a>`).join('')}</body></html>`
  return {
    url,
    finalUrl: url,
    status,
    headers: {},
    redirectChain: [],
    depth: 0,
    fetchedAt: '2026-10-05T00:00:00.000Z',
    preJsHtml: html,
    renderedHtml: html,
    extract: extractPage(html, url),
    render: compareRenders(html, html, url),
  }
}

/** A request context that answers every fetch with one status, and records what was asked. */
const contextAnswering = (status: number) => {
  const fetch = vi.fn(async () => ({
    status: () => status,
    headers: () => ({}),
    dispose: async () => {},
  }))
  return { context: { request: { fetch } } as unknown as BrowserContext, fetch }
}

describe('outboundCandidates', () => {
  it('treats the www and bare forms of the site as the site itself', () => {
    const pages = [
      page('https://www.shop.example/', [
        'https://shop.example/about',
        'https://www.shop.example/prices',
        'https://partner.example/offer',
      ]),
    ]

    expect(outboundCandidates(pages, 10).map((c) => c.url)).toEqual([
      'https://partner.example/offer',
    ])
  })

  it('ignores links that are not web pages, and pages that did not load', () => {
    const pages = [
      page('https://shop.example/', ['mailto:a@b.example', 'tel:+123', 'javascript:void(0)']),
      page('https://shop.example/broken', ['https://partner.example/x'], 500),
    ]

    expect(outboundCandidates(pages, 10)).toEqual([])
  })

  it('caps to the most-linked URLs, the same ones on every crawl', () => {
    const pages = [
      page('https://shop.example/', [
        'https://b.example/',
        'https://a.example/',
        'https://c.example/',
      ]),
      page('https://shop.example/two', ['https://c.example/']),
    ]

    const picked = outboundCandidates(pages, 2)
    expect(picked.map((c) => c.url)).toEqual(['https://c.example/', 'https://a.example/'])
    expect(picked[0]?.linkedFrom).toEqual(['https://shop.example/', 'https://shop.example/two'])
    // Order of discovery must not change the choice.
    expect(outboundCandidates([...pages].reverse(), 2).map((c) => c.url)).toEqual(
      picked.map((c) => c.url),
    )
  })

  it('checks nothing when the limit is zero', () => {
    expect(outboundCandidates([page('https://shop.example/', ['https://a.example/'])], 0)).toEqual(
      [],
    )
  })
})

describe('checkOutboundLinks', () => {
  const pages = [page('https://shop.example/', ['https://target.example/x'])]

  it('never requests a link the egress guard refuses, and does not call it broken', async () => {
    const { context, fetch } = contextAnswering(200)
    const blocked: string[] = []

    const [link] = await checkOutboundLinks(
      context,
      async () => 'target.example resolves to a private address.',
      pages,
      { limit: 10, onBlocked: (entry) => blocked.push(entry.url) },
    )

    expect(fetch).not.toHaveBeenCalled()
    expect(link).toMatchObject({ outcome: 'inconclusive', status: null })
    expect(blocked).toContain('https://target.example/x')
  })

  it('calls a link broken when its domain no longer exists', async () => {
    const { context, fetch } = contextAnswering(200)

    const [link] = await checkOutboundLinks(
      context,
      async () => 'target.example could not be resolved.',
      pages,
      { limit: 10 },
    )

    expect(fetch).not.toHaveBeenCalled()
    expect(link).toMatchObject({ outcome: 'broken', status: null })
    expect(link?.reason).toMatch(/could not be resolved/)
  })

  it('treats a timeout or a dropped connection as unknown, not as broken', async () => {
    const context = {
      request: {
        fetch: vi.fn(async () => {
          throw new Error('Timeout 10000ms exceeded')
        }),
      },
    } as unknown as BrowserContext

    const [link] = await checkOutboundLinks(context, async () => null, pages, { limit: 10 })

    expect(link).toMatchObject({ outcome: 'inconclusive', status: null })
  })

  it('vets every redirect hop, so a link cannot be bounced to a private address', async () => {
    const fetch = vi.fn(async () => ({
      status: () => 302,
      headers: () => ({ location: 'http://169.254.169.254/latest/meta-data' }),
      dispose: async () => {},
    }))
    const context = { request: { fetch } } as unknown as BrowserContext
    const guard = vi.fn(async (url: string) =>
      url.includes('169.254') ? '169.254.169.254 is a private address.' : null,
    )

    const [link] = await checkOutboundLinks(context, guard, pages, { limit: 10 })

    expect(guard).toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data')
    // The first hop was fetched; the private one never was.
    expect(
      (fetch.mock.calls as unknown[][]).every((call) => !String(call[0]).includes('169.254')),
    ).toBe(true)
    expect(link?.outcome).toBe('inconclusive')
  })
})
