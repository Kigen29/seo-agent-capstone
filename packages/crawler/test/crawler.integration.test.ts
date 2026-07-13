import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl, CrawlAbortedError, DEFAULT_USER_AGENT } from '../src/crawl/crawler.js'
import type { CrawlResult } from '../src/crawl/types.js'
import { startTestSite, type TestSite } from './server.js'

/**
 * A real browser against a real HTTP server. Slower than the unit tests and worth every
 * second: the story's falsification condition is "the crawler hammers a site, gets
 * blocked, or misses pages a browser can see", and none of those can be falsified
 * against a mock.
 */
describe('crawl: against a live server', () => {
  let site: TestSite
  let result: CrawlResult

  beforeAll(async () => {
    site = await startTestSite()
    result = await crawl({ seed: site.origin, delayMs: 0, concurrency: 2 })
  }, 120_000)

  afterAll(async () => {
    await site.close()
  })

  const pathsOf = (r: CrawlResult) => r.pages.map((p) => new URL(p.finalUrl).pathname).sort()

  it('crawls the pages a browser can see', () => {
    expect(pathsOf(result)).toContain('/')
    expect(pathsOf(result)).toContain('/a')
    expect(pathsOf(result)).toContain('/b')
  })

  it('never fetches a path robots.txt disallows', () => {
    // Not "did not report it". Did not REQUEST it. The server is the witness.
    expect(site.requests.map((r) => r.url)).not.toContain('/admin')

    expect(result.skipped).toContainEqual({
      url: `${site.origin}/admin`,
      reason: 'Disallowed by robots.txt.',
    })
  })

  it('identifies itself with a contact URL on every single request', () => {
    // A crawler hiding behind a browser UA is indistinguishable from a scraper, and the
    // first thing a site owner does about an unknown bot is block the IP range.
    expect(site.requests.length).toBeGreaterThan(3)

    for (const request of site.requests) {
      expect(request.userAgent).toBe(DEFAULT_USER_AGENT)
      expect(request.userAgent).toContain('+https://')
    }
  })

  it('follows a redirect chain and records every hop', () => {
    const redirected = result.pages.find((p) => p.url.endsWith('/redirect'))

    expect(redirected?.finalUrl).toBe(`${site.origin}/a`)
    expect(redirected?.status).toBe(200)
    expect(redirected?.redirectChain.map((u) => new URL(u).pathname)).toEqual([
      '/redirect',
      '/redirect-2',
    ])
  })

  it('records a 404 as a page with a status, not as a crash', () => {
    const missing = result.pages.find((p) => p.url.endsWith('/missing'))

    expect(missing?.status).toBe(404)
    expect(missing?.error).toBeUndefined()
  })

  it('captures the server HTML and the rendered DOM separately', () => {
    const csr = result.pages.find((p) => p.url.endsWith('/csr'))

    // The server sent an empty root. Note we assert on the DOM shape, not on the absence
    // of the string: the phrase appears in the inline script's source either way, which
    // is exactly why word count, not substring matching, is what CSR detection runs on.
    expect(csr?.preJsHtml).toContain('<div id="root"></div>')
    expect(csr?.preJsHtml).not.toMatch(/<div id="root"><h1>/)

    // The same page after the browser ran the script. This is what Google indexes.
    expect(csr?.renderedHtml).toMatch(/<div id="root"><h1>Rendered by JavaScript<\/h1>/)
  })

  it('detects a client-side-rendered page from the two renders', () => {
    const csr = result.pages.find((p) => p.url.endsWith('/csr'))

    expect(csr?.render.likelyCsrOnly).toBe(true)
    expect(csr?.render.preJsWordCount).toBe(0)
    expect(csr?.render.postJsWordCount).toBeGreaterThan(50)
  })

  it('does not flag a server-rendered page as client-rendered', () => {
    const home = result.pages.find((p) => new URL(p.finalUrl).pathname === '/')

    expect(home?.render.likelyCsrOnly).toBe(false)
  })

  it('extracts links and headings from the rendered DOM', () => {
    const home = result.pages.find((p) => new URL(p.finalUrl).pathname === '/')

    expect(home?.extract.h1s).toEqual(['Home'])
    expect(home?.extract.links.some((l) => l.href === '/a' && l.internal)).toBe(true)
    expect(home?.extract.links.some((l) => l.internal === false)).toBe(true)
  })

  it('does not follow a rel=nofollow link', () => {
    expect(site.requests.map((r) => r.url)).not.toContain('/nofollowed')
  })

  it('stays on the seed host rather than crawling the open web', () => {
    for (const page of result.pages) {
      expect(new URL(page.finalUrl).host).toBe(new URL(site.origin).host)
    }
  })

  it('finds a page that is in the sitemap but that nothing links to', () => {
    // The orphan. A pure link crawl never reaches it, which is the entire point of
    // reading the sitemap as well.
    expect(pathsOf(result)).toContain('/orphan')
    expect(result.sitemapOnlyUrls).toEqual([`${site.origin}/orphan`])
  })
})

describe('crawl: politeness', () => {
  it('spaces requests out, even with several workers running', async () => {
    const site = await startTestSite()

    try {
      const started = Date.now()
      await crawl({ seed: site.origin, delayMs: 150, concurrency: 3, maxPages: 4 })
      const elapsed = Date.now() - started

      // Four pages at 150ms apart is at least 450ms of enforced waiting. If the gate were
      // per-worker rather than global, three workers would fire at once and this passes in
      // well under that, which is exactly the "hammers the site" failure.
      expect(elapsed).toBeGreaterThanOrEqual(450)

      const documentRequests = site.requests.filter((r) => !r.url.includes('.'))
      const gaps = documentRequests
        .slice(1)
        .map((r, i) => r.at - (documentRequests[i]?.at ?? 0))
        .filter((gap) => gap > 0)

      expect(Math.max(...gaps)).toBeGreaterThan(50)
    } finally {
      await site.close()
    }
  }, 120_000)
})

describe('crawl: a failing persistence hook', () => {
  it('aborts, but hands back enough state to resume without refetching', async () => {
    const site = await startTestSite()

    try {
      let seen = 0

      const failing = crawl(
        { seed: site.origin, delayMs: 0, concurrency: 1, maxPages: 6 },
        {
          onPage: () => {
            seen += 1
            // The database falls over on the second page.
            if (seen === 2) throw new Error('database is down')
          },
        },
      )

      await expect(failing).rejects.toThrow(CrawlAbortedError)

      const error = await failing.catch((err: unknown) => err as CrawlAbortedError)

      // Without the state on the error, the caller has to start from page 1 and re-hammer
      // a site that already served us everything up to the failure.
      expect(error.state.visited).toHaveLength(1)
      expect(error.pages).toHaveLength(2)

      const requestsBefore = site.requests.filter((r) => r.url === '/').length

      const resumed = await crawl({
        seed: site.origin,
        delayMs: 0,
        concurrency: 1,
        maxPages: 6,
        resumeFrom: error.state,
      })

      // The page that was already persisted is not fetched again.
      expect(site.requests.filter((r) => r.url === '/').length).toBe(requestsBefore)
      expect(resumed.pages.length).toBeGreaterThan(0)
    } finally {
      await site.close()
    }
  }, 120_000)
})

describe('crawl: resumability', () => {
  it('resumes where it was killed rather than re-crawling from the start', async () => {
    const site = await startTestSite()

    try {
      const first = await crawl({ seed: site.origin, delayMs: 0, maxPages: 2, concurrency: 1 })
      expect(first.pages).toHaveLength(2)

      const before = site.requests.filter((r) => r.url === '/').length

      const second = await crawl({
        seed: site.origin,
        delayMs: 0,
        maxPages: 6,
        concurrency: 1,
        resumeFrom: first.state,
      })

      const firstPaths = first.pages.map((p) => new URL(p.finalUrl).pathname)
      const secondPaths = second.pages.map((p) => new URL(p.finalUrl).pathname)

      // Nothing already done is done again. Re-crawling a site that already served us
      // 47 pages is precisely the rudeness the story is written against.
      for (const path of firstPaths) {
        expect(secondPaths).not.toContain(path)
      }

      expect(second.pages.length).toBeGreaterThan(0)
      expect(site.requests.filter((r) => r.url === '/').length).toBe(before)
    } finally {
      await site.close()
    }
  }, 120_000)
})
