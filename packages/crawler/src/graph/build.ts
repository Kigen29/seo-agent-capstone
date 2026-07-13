import { normaliseUrl } from '../crawl/frontier.js'
import type { CrawledPage } from '../crawl/types.js'
import { pageRank } from './pagerank.js'

/**
 * The internal link graph.
 *
 * Internal linking is the highest-impact and most-neglected job in SEO, precisely
 * because doing it well is tedious. That makes it the ideal thing to hand to a machine.
 */

export interface GraphPage {
  url: string
  /** Internal, followed, resolved link targets. */
  outbound: string[]
}

export interface LinkGraphOptions {
  /** The homepage. Click depth is measured from here. */
  seed: string
  /** Depth beyond which a page is buried. Three clicks is the usual line. */
  nearOrphanDepth?: number
}

export interface GraphNode {
  url: string
  inboundCount: number
  outboundCount: number
  /** Hops from the seed following internal followed links. null means unreachable. */
  clickDepth: number | null
  pageRank: number
}

export interface LinkGraph {
  nodes: Map<string, GraphNode>
  /**
   * Zero internal inbound links. Nothing on the site points here, so a crawler arriving
   * at the homepage can never walk to it. In the sitemap but orphaned is the classic case.
   */
  orphans: string[]
  /** Reachable, but buried deeper than nearOrphanDepth clicks from home. */
  nearOrphans: string[]
  /** Reachable from the homepage by following links at all. */
  unreachable: string[]
}

/**
 * Build the edge list from a crawl.
 *
 * Only INTERNAL and FOLLOWED links become edges. A rel=nofollow link passes no equity
 * and Googlebot does not follow it, so counting it would tell a site its orphaned page
 * is fine when in ranking terms it is not.
 *
 * Self-links are dropped: a page linking to itself is not inbound authority.
 */
export function toGraphPages(pages: readonly CrawledPage[]): GraphPage[] {
  return pages.map((page) => {
    const from = normaliseUrl(page.finalUrl) ?? page.finalUrl

    const outbound = new Set<string>()
    for (const link of page.extract.links) {
      if (!link.internal || link.nofollow || !link.resolved) continue

      const to = normaliseUrl(link.resolved)
      if (!to || to === from) continue

      outbound.add(to)
    }

    return { url: from, outbound: [...outbound] }
  })
}

export function buildLinkGraph(pages: readonly GraphPage[], options: LinkGraphOptions): LinkGraph {
  const nearOrphanDepth = options.nearOrphanDepth ?? 3
  const seed = normaliseUrl(options.seed) ?? options.seed

  /**
   * Only pages we actually crawled are nodes. A link to a page we never fetched is not
   * evidence that the page exists, and inventing a node for it would put phantom URLs in
   * the orphan list.
   */
  const known = new Set(pages.map((page) => page.url))

  const outbound = new Map<string, string[]>()
  const inboundCount = new Map<string, number>()

  for (const url of known) {
    outbound.set(url, [])
    inboundCount.set(url, 0)
  }

  for (const page of pages) {
    const targets = page.outbound.filter((url) => known.has(url))
    outbound.set(page.url, targets)

    for (const target of targets) {
      inboundCount.set(target, (inboundCount.get(target) ?? 0) + 1)
    }
  }

  // Breadth-first from the homepage. The first time we reach a page is its click depth,
  // because BFS explores every page at depth n before any page at depth n + 1.
  const clickDepth = new Map<string, number>()
  if (known.has(seed)) {
    clickDepth.set(seed, 0)

    // A cursor rather than shift(). Array.shift reindexes the whole array, which makes
    // the traversal quadratic in the number of pages. It does not bite at a 500-page cap,
    // but it is free to avoid and it stops being free if that cap ever moves.
    const queue: string[] = [seed]
    let cursor = 0

    while (cursor < queue.length) {
      const current = queue[cursor] as string
      cursor += 1

      const depth = clickDepth.get(current) ?? 0

      for (const target of outbound.get(current) ?? []) {
        if (clickDepth.has(target)) continue
        clickDepth.set(target, depth + 1)
        queue.push(target)
      }
    }
  }

  const ranks = pageRank(outbound)

  const nodes = new Map<string, GraphNode>()
  const orphans: string[] = []
  const nearOrphans: string[] = []
  const unreachable: string[] = []

  for (const url of known) {
    const depth = clickDepth.has(url) ? (clickDepth.get(url) as number) : null
    const inbound = inboundCount.get(url) ?? 0

    nodes.set(url, {
      url,
      inboundCount: inbound,
      outboundCount: outbound.get(url)?.length ?? 0,
      clickDepth: depth,
      pageRank: ranks.get(url) ?? 0,
    })

    // The homepage has no internal inbound links on most sites and is reachable by
    // definition. Calling it an orphan would flag every site on earth.
    if (inbound === 0 && url !== seed) orphans.push(url)
    if (depth === null && url !== seed) unreachable.push(url)
    if (depth !== null && depth > nearOrphanDepth) nearOrphans.push(url)
  }

  return { nodes, orphans, nearOrphans, unreachable }
}
