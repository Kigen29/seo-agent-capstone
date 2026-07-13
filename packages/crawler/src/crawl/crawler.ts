import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { extractPage } from '../page/extract.js'
import { compareRenders } from '../page/render.js'
import { crawlDelayFor, isAllowed } from '../robots/match.js'
import { ALLOW_ALL, parseRobotsTxt, type RobotsTxt } from '../robots/parse.js'
import { expandSitemaps } from '../sitemap/expand.js'
import { Frontier, normaliseUrl, type FrontierState } from './frontier.js'
import { Pacer } from './pacer.js'
import type { CrawledPage, CrawlResult, SkippedUrl } from './types.js'

/**
 * Identify yourself, and give them a way to complain.
 *
 * A crawler that hides behind a browser user agent is indistinguishable from a scraper,
 * and the first thing a site owner does when an unknown bot hurts their origin is block
 * the whole IP range. The contact URL is not decoration: it is what turns "block them"
 * into "email them".
 */
export const DEFAULT_USER_AGENT =
  'Rankwright/0.1 (SEO audit agent; +https://seo-agent-capstone.vercel.app)'

export interface CrawlOptions {
  seed: string
  maxPages?: number
  /** Parallel workers. Keep it low: we are a guest on someone else's origin. */
  concurrency?: number
  /** Floor on the gap between requests. robots.txt Crawl-delay overrides it upwards. */
  delayMs?: number
  userAgent?: string
  respectRobots?: boolean
  sameHostOnly?: boolean
  timeoutMs?: number
  captureScreenshots?: boolean
  /** Seed the frontier from the sitemap too, which finds pages no link points at. */
  useSitemap?: boolean
  /** Resume a crawl that was killed. Skips everything already completed. */
  resumeFrom?: FrontierState
}

/**
 * Thrown when a persistence hook fails.
 *
 * A crawl that cannot store its results is pointless, so we do not swallow this and
 * carry on. But dying without handing back the frontier state would force the caller to
 * restart from page 1 and re-hammer a site that already served us hundreds of pages,
 * which is the precise rudeness this crawler is built to avoid. So the error carries
 * everything needed to resume: pass `state` back as `resumeFrom` and nothing is refetched.
 */
export class CrawlAbortedError extends Error {
  constructor(
    override readonly cause: unknown,
    readonly pages: CrawledPage[],
    readonly state: FrontierState,
  ) {
    super(
      `The crawl was aborted after ${pages.length} page(s) because a persistence hook failed: ` +
        `${cause instanceof Error ? cause.message : String(cause)}. ` +
        `Pass the .state on this error as resumeFrom to continue without refetching.`,
    )
    this.name = 'CrawlAbortedError'
  }
}

export interface CrawlHooks {
  /**
   * Called after each page. Persist here, and persist the state alongside it: the
   * frontier only marks a page complete after this resolves, so a crash mid-hook
   * re-crawls that one page rather than losing it.
   */
  onPage?: (page: CrawledPage, state: FrontierState) => Promise<void> | void
  onSkip?: (skip: SkippedUrl) => void
}

function headerRecord(headers: Record<string, string>): Record<string, string> {
  const lowered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value
  return lowered
}

async function fetchRobots(context: BrowserContext, seed: string): Promise<RobotsTxt> {
  const robotsUrl = new URL('/robots.txt', seed).toString()

  try {
    const response = await context.request.get(robotsUrl, { timeout: 15_000 })

    // 4xx means no robots.txt, which means no restrictions. A 5xx arguably means we
    // should back off entirely, but treating a flaky origin as "block everything" would
    // make the audit fail rather than proceed, so we proceed and say so.
    if (!response.ok()) return ALLOW_ALL

    return parseRobotsTxt(await response.text())
  } catch {
    return ALLOW_ALL
  }
}

async function crawlOne(
  page: Page,
  url: string,
  depth: number,
  options: Required<Pick<CrawlOptions, 'timeoutMs' | 'captureScreenshots'>>,
): Promise<CrawledPage> {
  const base: Omit<CrawledPage, 'extract' | 'render'> = {
    url,
    finalUrl: url,
    status: 0,
    headers: {},
    redirectChain: [],
    depth,
    fetchedAt: new Date().toISOString(),
    preJsHtml: '',
    renderedHtml: '',
  }

  try {
    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: options.timeoutMs,
    })

    if (!response) {
      const empty = extractPage('', url)
      return {
        ...base,
        extract: empty,
        render: compareRenders('', '', url),
        error: 'No response.',
      }
    }

    /**
     * response.text() is the body the SERVER sent, before any script executed.
     * page.content() is the DOM after they did. One navigation, both surfaces, so we
     * never fetch a page twice just to see it with and without JavaScript.
     */
    const preJsHtml = await response.text()
    const renderedHtml = await page.content()

    // Walk the redirect chain backwards from the response we ended on.
    const redirectChain: string[] = []
    let request = response.request().redirectedFrom()
    while (request) {
      redirectChain.unshift(request.url())
      request = request.redirectedFrom()
    }

    const headers = headerRecord(await response.allHeaders())
    const finalUrl = page.url()

    return {
      ...base,
      finalUrl,
      status: response.status(),
      headers,
      redirectChain,
      preJsHtml,
      renderedHtml,
      xRobotsTag: headers['x-robots-tag'],
      extract: extractPage(renderedHtml, finalUrl),
      render: compareRenders(preJsHtml, renderedHtml, finalUrl),
      screenshot: options.captureScreenshots
        ? await page.screenshot({ type: 'jpeg', quality: 50 })
        : undefined,
    }
  } catch (err) {
    // A page that times out or refuses the connection is a finding, not a crash. Record
    // it and carry on: one dead page must not cost us the other 499.
    const empty = extractPage('', url)
    return {
      ...base,
      extract: empty,
      render: compareRenders('', '', url),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function crawl(options: CrawlOptions, hooks: CrawlHooks = {}): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 500
  const concurrency = options.concurrency ?? 2
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const respectRobots = options.respectRobots ?? true
  const sameHostOnly = options.sameHostOnly ?? true
  const timeoutMs = options.timeoutMs ?? 30_000
  const captureScreenshots = options.captureScreenshots ?? false

  const pages: CrawledPage[] = []
  const skipped: SkippedUrl[] = []

  let browser: Browser | undefined

  try {
    browser = await chromium.launch()
    const context = await browser.newContext({ userAgent })

    const robots = respectRobots ? await fetchRobots(context, options.seed) : ALLOW_ALL

    /**
     * Crawl-delay is the site telling us how fast it can stand to be crawled. Honour it
     * when it is slower than our own floor. Never speed up because a site did not ask us
     * to slow down.
     */
    const robotsDelay = (crawlDelayFor(robots, userAgent) ?? 0) * 1000
    const pacer = new Pacer(Math.max(options.delayMs ?? 250, robotsDelay))

    const frontier = options.resumeFrom
      ? Frontier.fromState(options.seed, options.resumeFrom, { maxPages, sameHostOnly })
      : new Frontier(options.seed, { maxPages, sameHostOnly })

    const fromSitemap = new Set<string>()

    if (options.useSitemap !== false && robots.sitemaps.length > 0) {
      const expanded = await expandSitemaps(robots.sitemaps, async (url) => {
        const response = await context.request.get(url, { timeout: 15_000 })
        return response.ok() ? response.text() : undefined
      })

      for (const entry of expanded.urls) {
        const normalised = normaliseUrl(entry.loc)
        if (normalised) fromSitemap.add(normalised)
      }

      frontier.add([...fromSitemap], 1)
    }

    /** Every URL a link actually pointed at. The difference is the orphan set. */
    const linkedTo = new Set<string>()

    const worker = async (): Promise<void> => {
      const page = await context.newPage()

      try {
        for (;;) {
          const entry = frontier.next()
          if (!entry) break

          if (respectRobots && !isAllowed(robots, userAgent, entry.url)) {
            const skip = { url: entry.url, reason: 'Disallowed by robots.txt.' }
            skipped.push(skip)
            hooks.onSkip?.(skip)
            frontier.complete(entry.url)
            continue
          }

          await pacer.wait()

          const crawled = await crawlOne(page, entry.url, entry.depth, {
            timeoutMs,
            captureScreenshots,
          })

          pages.push(crawled)

          for (const link of crawled.extract.links) {
            if (!link.internal || !link.resolved) continue
            const normalised = normaliseUrl(link.resolved)
            if (normalised) linkedTo.add(normalised)
          }

          if (!crawled.extract.metaRobots.follow) {
            // The page says nofollow. Do not harvest its links.
          } else {
            frontier.add(
              crawled.extract.links
                .filter((link) => link.internal && !link.nofollow && link.resolved)
                .map((link) => link.resolved as string),
              entry.depth + 1,
            )
          }

          // Persist BEFORE marking complete. A crash between the two re-crawls one page,
          // which is cheap. The other order loses it, which is not.
          try {
            await hooks.onPage?.(crawled, frontier.toState())
          } catch (err) {
            // This page is deliberately NOT marked complete, so a resume refetches it.
            throw new CrawlAbortedError(err, pages, frontier.toState())
          }

          frontier.complete(entry.url)
        }
      } finally {
        await page.close()
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    /**
     * In the sitemap, but no internal link points at it. The seed is excluded: the
     * homepage is reachable by definition and nothing links to it from within the site,
     * so leaving it in would report every site on earth as having an orphaned homepage.
     */
    const seedUrl = normaliseUrl(options.seed)

    return {
      pages,
      skipped,
      sitemapOnlyUrls: [...fromSitemap].filter((url) => !linkedTo.has(url) && url !== seedUrl),
      state: frontier.toState(),
    }
  } finally {
    await browser?.close()
  }
}
