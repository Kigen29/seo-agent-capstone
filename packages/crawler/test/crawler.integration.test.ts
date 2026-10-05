import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl, CrawlAbortedError, DEFAULT_USER_AGENT } from '../src/crawl/crawler.js'
import type { CrawlResult } from '../src/crawl/types.js'
import { startTestSite, type TestSite } from './server.js'

/** The fixture server listens on 127.0.0.1, which production egress rightly refuses. */
const LOCAL = { allowPrivateNetwork: true }

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
    result = await crawl({
      seed: site.origin,
      egress: LOCAL,
      delayMs: 0,
      concurrency: 2,
      // Every page, so the wide one is in the sample whatever order the URLs sort in.
      mobileSampleSize: 50,
    })
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

  it('waits for a client-rendered page to fetch its content before reading it', () => {
    // Read at the load event, this page is empty: its content arrives from an API 600ms later.
    const late = result.pages.find((p) => p.url.endsWith('/csr-late'))

    expect(late?.extract.h1s).toEqual(['Loaded from the API'])
    expect(late?.render.postJsWordCount).toBeGreaterThan(50)
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

  describe('rendered again at phone width', () => {
    const renderOf = (path: string) =>
      result.mobile?.find((render) => new URL(render.url).pathname === path)

    it('measures a page that fits as exactly as wide as the phone', () => {
      expect(renderOf('/a')).toMatchObject({ viewportWidth: 375, overflowPx: 0 })
    })

    it('measures how far a fixed-width element pushes a page past the screen', () => {
      // The viewport tag on this page is correct. Only rendering it shows the problem.
      const wide = renderOf('/wide')
      expect(result.pages.find((p) => p.url.endsWith('/wide'))?.extract.viewport).toMatch(
        /width=device-width/,
      )
      expect(wide?.contentWidth).toBeGreaterThanOrEqual(1200)
      expect(wide?.overflowPx).toBeGreaterThan(800)
    })

    it('renders only pages that loaded, each once', () => {
      const paths = (result.mobile ?? []).map((render) => new URL(render.url).pathname)
      expect(new Set(paths).size).toBe(paths.length)
      expect(paths).not.toContain('/missing')
    })
  })

  describe('links that leave the site', () => {
    const outcomeOf = (path: string) =>
      result.outbound?.find((link) => link.url === `${site.external}${path}`)

    it('checks each external link once, however often it appears', () => {
      // `/alive` and `/alive#section` are one page; a mailto: is not a page at all.
      expect(result.outbound).toHaveLength(8)
      expect(result.outbound?.filter((link) => link.url.endsWith('/alive'))).toHaveLength(1)
    })

    it('calls a link broken only when the page is gone', () => {
      expect(outcomeOf('/gone')).toMatchObject({ outcome: 'broken', status: 404 })
      expect(outcomeOf('/removed')).toMatchObject({ outcome: 'broken', status: 410 })
      // Followed to where it lands: a redirect to a deleted page is a deleted page.
      expect(outcomeOf('/moved-to-nowhere')).toMatchObject({ outcome: 'broken', status: 404 })
      expect(outcomeOf('/gone')?.linkedFrom).toEqual([`${site.origin}/`])
    })

    it('does not call a link broken because the site refused a crawler or had a bad moment', () => {
      // Sending a person to "fix" a link that works is how an audit gets ignored.
      expect(outcomeOf('/blocks-bots')).toMatchObject({ outcome: 'inconclusive', status: 403 })
      expect(outcomeOf('/flaky')).toMatchObject({ outcome: 'inconclusive', status: 503 })
    })

    it('does not trust HEAD on its own, because many servers answer it wrongly', () => {
      expect(outcomeOf('/head-lies')).toMatchObject({ outcome: 'ok', status: 200 })
      const methods = site.externalRequests
        .filter((request) => request.url === '/head-lies')
        .map((request) => request.method)
      expect(methods).toEqual(['HEAD', 'GET'])
    })

    it('reports a working link and a moved one as fine, with one cheap request each', () => {
      expect(outcomeOf('/alive')).toMatchObject({ outcome: 'ok', status: 200 })
      expect(outcomeOf('/moved')).toMatchObject({ outcome: 'ok', status: 200 })
      expect(
        site.externalRequests.filter(
          (request) => request.url === '/alive' && request.method === 'GET',
        ),
      ).toHaveLength(0)
    })

    it('never crawls the outside site: it asks about the linked pages and nothing else', () => {
      const asked = new Set(site.externalRequests.map((request) => request.url))
      expect([...asked].sort()).toEqual([
        '/alive',
        '/blocks-bots',
        '/flaky',
        '/gone',
        '/head-lies',
        '/moved',
        '/moved-to-nowhere',
        '/removed',
      ])
    })
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

  /**
   * The crawl already fetched robots.txt and expanded the sitemap in order to obey them.
   * Handing both back is what lets a caller build a RuleContext without going back to the
   * network, and everything downstream depends on it.
   */
  describe('hands back what it already fetched', () => {
    it('returns the robots.txt it actually obeyed, so nobody fetches it twice', () => {
      // Re-fetching would be a second request to someone else's origin for bytes we already
      // have. Worse, a robots.txt that changed between the two fetches would leave the audit
      // reporting on a file the crawl never obeyed.
      const robotsRequests = site.requests.filter((r) => r.url === '/robots.txt')

      expect(robotsRequests).toHaveLength(1)
      expect(result.robots.absent).toBe(false)
      expect(result.robots.sitemaps).toEqual([`${site.origin}/sitemap.xml`])
    })

    it('returns the AI crawler posture, which is what TECH-002 reads', () => {
      // The test site allows everyone, so nothing is blocked. The assertion that matters is
      // that the posture is present and populated at all: an undefined posture crashes the
      // rule engine, which is exactly how this gap was found.
      expect(result.posture.blockedSearchAgents).toEqual([])
      expect(result.posture.verdicts.length).toBeGreaterThan(0)
    })

    it('returns every URL the sitemap declared, not just the orphans', () => {
      // sitemapOnlyUrls is a filtered view and cannot substitute for this: the rules that
      // ask "is this indexable page missing from the sitemap?" need the full declared set,
      // and a linked page correctly listed in the sitemap never appears in the orphan list.
      expect(result.sitemapUrls).toContain(`${site.origin}/orphan`)
      expect(result.sitemapUrls.length).toBeGreaterThan(result.sitemapOnlyUrls.length)
    })
  })
})

describe('crawl: politeness', () => {
  it('spaces requests out, even with several workers running', async () => {
    const site = await startTestSite()

    try {
      const started = Date.now()
      await crawl({ seed: site.origin, egress: LOCAL, delayMs: 150, concurrency: 3, maxPages: 4 })
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
        { seed: site.origin, egress: LOCAL, delayMs: 0, concurrency: 1, maxPages: 6 },
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
        egress: LOCAL,
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
      const first = await crawl({
        seed: site.origin,
        egress: LOCAL,
        delayMs: 0,
        maxPages: 2,
        concurrency: 1,
      })
      expect(first.pages).toHaveLength(2)

      const before = site.requests.filter((r) => r.url === '/').length

      const second = await crawl({
        seed: site.origin,
        egress: LOCAL,
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
