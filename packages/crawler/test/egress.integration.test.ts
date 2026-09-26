import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl } from '../src/crawl/crawler.js'
import type { EgressPolicy } from '../src/crawl/egress.js'
import { isLeak, startHostileSite, type HostileSite } from './hostile-server.js'

/**
 * `localhost` plays the internal host. The seed is on the 127.0.0.1 literal, which these tests
 * treat as public so the crawl can start; everything `localhost` resolves to is treated as private.
 */
const hostile: EgressPolicy = {
  resolve: async (hostname) => {
    if (hostname === 'localhost') return [{ address: '10.0.0.9', family: 4 }]
    throw new Error(`unexpected lookup: ${hostname}`)
  },
  isBlocked: (address) => address !== '127.0.0.1',
}

// Screenshots on, so images load and every asset path goes through the guard. A normal audit
// skips images entirely, which the last test covers.
const run = (site: HostileSite, egress: EgressPolicy) =>
  crawl({
    seed: `${site.origin}/`,
    egress,
    delayMs: 0,
    concurrency: 1,
    maxPages: 5,
    captureScreenshots: true,
  })

describe('crawl: browser egress', () => {
  let site: HostileSite

  beforeAll(async () => {
    site = await startHostileSite()
  })

  afterAll(async () => {
    await site.close()
  })

  it('the hostile page really does reach the internal host when nothing guards it', async () => {
    // The control. Without it, "no leak" below could just mean the fixture never fired.
    site.requests.length = 0
    await run(site, { allowPrivateNetwork: true })
    // No WebSocket here: once the page is served through the route handler, Chromium's own
    // Local Network Access check refuses a socket from it to loopback. That is Chromium's policy,
    // not ours, so the guarded test below proves our WebSocket route refuses it independently.
    const leaked = site.requests.filter(isLeak)
    expect(leaked).toEqual(
      expect.arrayContaining([
        '/leak/img',
        '/leak/iframe',
        '/leak/fetch',
        '/leak/redirect',
        '/leak/sitemap',
        '/leak/llms',
      ]),
    )
  }, 60_000)

  it('refuses every page-initiated and root-file request to a private address', async () => {
    site.requests.length = 0
    const result = await run(site, hostile)

    // The server is the witness: nothing under /leak/ arrived.
    expect(site.requests.filter(isLeak)).toEqual([])
    // The page itself was still crawled and audited.
    expect(site.requests).toContain('/')
    expect(result.pages.map((page) => new URL(page.url).pathname)).toContain('/')

    const refused = (result.blocked ?? []).map((entry) => new URL(entry.url).pathname)
    expect(refused).toEqual(
      expect.arrayContaining([
        '/leak/img',
        '/leak/iframe',
        '/leak/fetch',
        '/leak/ws',
        '/leak/redirect',
        '/leak/sitemap',
        '/leak/llms',
      ]),
    )
    expect(result.llmsTxt).toBeNull()
  }, 60_000)

  it('never requests an image at all when no screenshot needs one', async () => {
    site.requests.length = 0
    const result = await crawl({
      seed: `${site.origin}/`,
      egress: { allowPrivateNetwork: true },
      delayMs: 0,
      concurrency: 1,
      maxPages: 5,
    })
    expect(result.pages.length).toBeGreaterThan(0)
    expect(site.requests).not.toContain('/leak/img')
  }, 60_000)

  it('does not fetch anything from a seed on a private address', async () => {
    site.requests.length = 0
    const result = await crawl({ seed: `${site.internal}/`, egress: hostile, delayMs: 0 })

    expect(site.requests).toEqual([])
    expect(result.pages).toEqual([])
    expect(result.skipped[0]?.reason).toMatch(/^Refused by egress policy/)
  }, 60_000)
})
