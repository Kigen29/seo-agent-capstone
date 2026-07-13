/**
 * Internal PageRank: which of a site's own pages its own linking treats as important.
 *
 * This is not Google's PageRank and we must never claim it is. It is the same algorithm
 * run over one site's internal link graph, which tells you where a site concentrates its
 * own authority. It is useful for exactly one thing: finding a page that deserves link
 * equity and is not getting any.
 */

export interface PageRankOptions {
  /** Probability a surfer follows a link rather than jumping to a random page. */
  damping?: number
  maxIterations?: number
  /** Stop once the total change across all pages falls below this. */
  epsilon?: number
}

export function pageRank(
  outbound: ReadonlyMap<string, readonly string[]>,
  options: PageRankOptions = {},
): Map<string, number> {
  const damping = options.damping ?? 0.85
  const maxIterations = options.maxIterations ?? 100
  const epsilon = options.epsilon ?? 1e-6

  const nodes = [...outbound.keys()]
  const n = nodes.length
  if (n === 0) return new Map()

  const ranks = new Map<string, number>(nodes.map((url) => [url, 1 / n]))

  /** Who links TO each page. PageRank pulls from in-links, so invert once up front. */
  const inbound = new Map<string, string[]>(nodes.map((url) => [url, []]))
  for (const [source, targets] of outbound) {
    for (const target of targets) {
      inbound.get(target)?.push(source)
    }
  }

  const outDegree = new Map<string, number>(
    nodes.map((url) => [url, outbound.get(url)?.length ?? 0]),
  )

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    /**
     * Pages with no outbound internal links are "dangling": they absorb rank and never
     * pass it on. Left unhandled, total rank leaks away every iteration and every score
     * ends up wrong, subtly, in a way that still looks plausible. Their mass is
     * redistributed evenly, which is the standard fix and the one everyone forgets.
     */
    let danglingMass = 0
    for (const url of nodes) {
      if ((outDegree.get(url) ?? 0) === 0) danglingMass += ranks.get(url) ?? 0
    }

    const next = new Map<string, number>()
    let delta = 0

    for (const url of nodes) {
      let incoming = 0
      for (const source of inbound.get(url) ?? []) {
        const degree = outDegree.get(source) ?? 0
        if (degree > 0) incoming += (ranks.get(source) ?? 0) / degree
      }

      const rank = (1 - damping) / n + damping * (incoming + danglingMass / n)

      next.set(url, rank)
      delta += Math.abs(rank - (ranks.get(url) ?? 0))
    }

    for (const [url, rank] of next) ranks.set(url, rank)

    if (delta < epsilon) break
  }

  return ranks
}
