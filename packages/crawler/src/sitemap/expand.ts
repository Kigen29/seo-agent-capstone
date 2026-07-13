import { parseSitemap, type SitemapUrl } from './parse.js'

/**
 * Follow a sitemap index down to the actual URLs.
 *
 * The fetcher is injected rather than imported, so this is a pure function of its inputs
 * and the whole recursion is testable without a network. It is also how the crawler will
 * hand in a fetcher that already respects robots.txt and the crawl delay.
 */
export type SitemapFetcher = (url: string) => Promise<string | undefined>

export interface ExpandOptions {
  /** How deep a chain of indexes to follow. Indexes pointing at indexes are legal. */
  maxDepth?: number
  /** Hard cap on documents fetched, so a hostile or broken site cannot spin us forever. */
  maxSitemaps?: number
}

export interface SitemapProblem {
  url: string
  reason: string
}

export interface ExpandedSitemap {
  urls: SitemapUrl[]
  /** Every document we successfully read, in fetch order. */
  visited: string[]
  /** Sitemaps we could not fetch or could not parse. Each is a finding in its own right. */
  problems: SitemapProblem[]
  /** True when we stopped early, so the URL list is known to be incomplete. */
  truncated: boolean
}

export async function expandSitemaps(
  roots: readonly string[],
  fetcher: SitemapFetcher,
  options: ExpandOptions = {},
): Promise<ExpandedSitemap> {
  const maxDepth = options.maxDepth ?? 3
  const maxSitemaps = options.maxSitemaps ?? 50

  const urls: SitemapUrl[] = []
  const visited: string[] = []
  const problems: SitemapProblem[] = []

  /** Guards against an index that points at itself, directly or in a cycle. */
  const seen = new Set<string>()
  let truncated = false

  const queue: { url: string; depth: number }[] = roots.map((url) => ({ url, depth: 0 }))

  while (queue.length > 0) {
    const next = queue.shift()
    if (!next) break

    const { url, depth } = next

    if (seen.has(url)) continue
    seen.add(url)

    if (visited.length >= maxSitemaps) {
      truncated = true
      break
    }

    let xml: string | undefined
    try {
      xml = await fetcher(url)
    } catch (err) {
      problems.push({ url, reason: `Could not be fetched: ${String(err)}` })
      continue
    }

    if (xml === undefined) {
      problems.push({ url, reason: 'Could not be fetched.' })
      continue
    }

    const sitemap = parseSitemap(xml)
    visited.push(url)

    if (sitemap.kind === 'unparseable') {
      problems.push({ url, reason: sitemap.reason })
      continue
    }

    if (sitemap.kind === 'urlset') {
      urls.push(...sitemap.urls)
      if (sitemap.oversized) {
        problems.push({
          url,
          reason: `More than 50,000 URLs. Search engines will ignore the excess; split it into a sitemap index.`,
        })
      }
      continue
    }

    if (depth >= maxDepth) {
      truncated = true
      problems.push({
        url,
        reason: `Sitemap index nested deeper than ${maxDepth} levels. Not followed further.`,
      })
      continue
    }

    for (const child of sitemap.sitemaps) {
      queue.push({ url: child, depth: depth + 1 })
    }
  }

  return { urls, visited, problems, truncated }
}
