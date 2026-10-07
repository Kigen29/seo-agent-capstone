import { publicFetch, type PublicFetchOptions } from '@seo/connectors'
import { ALLOW_ALL, extractPage, isAllowed, parseRobotsTxt, parseSitemap } from '@seo/crawler'

/**
 * What a competitor's public pages say today (ADR-0034).
 *
 * A snapshot is a handful of facts a parser can read off served HTML: each page's title, meta
 * description and first H1, and the list of URLs their sitemap declares. No model is involved at
 * any point. Whether something changed is a string comparison, and a string comparison does not
 * need an opinion.
 *
 * Every request goes through `publicFetch`, the one SSRF guard in the product. A competitor's
 * hostname is text a tenant typed, which makes it exactly as trustworthy as the URL a stranger
 * types into the public check.
 */

/**
 * How many pages are read per competitor per week.
 *
 * Small on purpose. This is somebody else's server and we are reading it to learn, not to mirror
 * it; a dozen requests a week is a visit, and it is also what keeps a snapshot to a few kilobytes.
 */
export const MAX_WATCHED_PAGES = 12

/** A sitemap larger than this is truncated, so one enormous competitor cannot fill the table. */
export const MAX_SITEMAP_URLS = 2_000

/** Titles and descriptions are compared and shown, never indexed, so a long one is cut. */
const MAX_TEXT = 300

/** The token `publicFetch` identifies itself with, which is the one robots.txt is asked about. */
const USER_AGENT = 'RankwrightCheck'

export interface WatchedPage {
  url: string
  title: string | null
  description: string | null
  h1: string | null
}

export interface CompetitorSnapshot {
  pages: WatchedPage[]
  /** Every URL their sitemap declares on their own host, sorted. Empty when there is no sitemap. */
  sitemapUrls: string[]
  /**
   * Why nothing was read, when nothing was. A snapshot with a note is not evidence of anything and
   * is never diffed: "we could not look this week" must not become "everything changed".
   */
  note: string | null
}

export interface SnapshotOptions {
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch
  /** Injected for tests, so DNS behaviour can be driven without a network. */
  resolve?: PublicFetchOptions['resolve']
}

const guard = (options: SnapshotOptions): PublicFetchOptions => ({
  ...(options.fetch ? { fetch: options.fetch } : {}),
  ...(options.resolve ? { resolve: options.resolve } : {}),
})

/** Whitespace collapsed and length capped, so a reformatted template is not a changed title. */
const tidy = (text: string | null | undefined): string | null => {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim()
  return collapsed ? collapsed.slice(0, MAX_TEXT) : null
}

async function text(
  url: string,
  options: SnapshotOptions,
  maxBytes: number,
): Promise<string | null> {
  try {
    const result = await publicFetch(url, { ...guard(options), maxBytes, timeoutMs: 8_000 })
    return result.status === 200 ? result.body : null
  } catch {
    return null
  }
}

const sameHost = (url: string, host: string): boolean => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === host.replace(/^www\./, '')
  } catch {
    return false
  }
}

/** Shallowest paths first, then alphabetical: the same pages are chosen every week. */
const byDepthThenName = (a: string, b: string): number => {
  const depth = (url: string) => new URL(url).pathname.split('/').filter(Boolean).length
  return depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** The URLs their sitemap declares, following one level of sitemap index and no further. */
async function sitemapUrls(
  origin: string,
  host: string,
  declared: string[],
  options: SnapshotOptions,
): Promise<string[]> {
  const location = declared.find((url) => sameHost(url, host)) ?? `${origin}/sitemap.xml`
  const xml = await text(location, options, 2_000_000)
  if (xml === null) return []

  let sitemap = parseSitemap(xml)
  if (sitemap.kind === 'index') {
    const child = sitemap.sitemaps.find((url) => sameHost(url, host))
    const childXml = child ? await text(child, options, 2_000_000) : null
    if (childXml === null) return []
    sitemap = parseSitemap(childXml)
  }
  if (sitemap.kind !== 'urlset') return []

  return [...new Set(sitemap.urls.map((entry) => entry.loc).filter((url) => sameHost(url, host)))]
    .sort()
    .slice(0, MAX_SITEMAP_URLS)
}

async function readPage(url: string, options: SnapshotOptions): Promise<WatchedPage | null> {
  try {
    const result = await publicFetch(url, { ...guard(options), timeoutMs: 8_000 })
    if (result.status !== 200) return null
    const extract = extractPage(result.body, result.finalUrl)
    return {
      url,
      title: tidy(extract.title),
      description: tidy(extract.metaDescription),
      h1: tidy(extract.headings.find((heading) => heading.level === 1)?.text),
    }
  } catch {
    return null
  }
}

/**
 * Read one competitor.
 *
 * Never throws: a competitor that is down, misconfigured or unwilling is a fact about this week,
 * recorded in `note`, and must not stop the sweep reaching the next one.
 */
export async function takeSnapshot(
  competitor: string,
  options: SnapshotOptions = {},
): Promise<CompetitorSnapshot> {
  const host = competitor.trim().toLowerCase()
  const origin = `https://${host}`
  const home = `${origin}/`

  const robotsTxt = await text(`${origin}/robots.txt`, options, 500_000)
  const robots = robotsTxt === null ? ALLOW_ALL : parseRobotsTxt(robotsTxt)

  // Their robots.txt is a request about exactly this kind of visit, so it is honoured.
  if (!isAllowed(robots, USER_AGENT, home)) {
    return {
      pages: [],
      sitemapUrls: [],
      note: `${host}'s robots.txt asks crawlers like ours to stay out, so nothing was read.`,
    }
  }

  const declared = await sitemapUrls(origin, host, robots.sitemaps, options)

  const candidates = [
    home,
    ...declared.filter((url) => url !== home && url !== origin).sort(byDepthThenName),
  ]
    .filter((url) => isAllowed(robots, USER_AGENT, url))
    .slice(0, MAX_WATCHED_PAGES)

  // One at a time. A dozen requests in a burst is how a polite visit starts looking like a probe.
  const pages: WatchedPage[] = []
  for (const url of candidates) {
    const page = await readPage(url, options)
    if (page) pages.push(page)
  }

  if (pages.length === 0) {
    return {
      pages: [],
      sitemapUrls: [],
      note: `${host} did not answer, so nothing was read this week.`,
    }
  }

  return { pages, sitemapUrls: declared, note: null }
}
