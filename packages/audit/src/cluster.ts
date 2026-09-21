/**
 * Group vectors into clusters, deterministically.
 *
 * This is the half of the topic map that ADR-0024 rests on. A model produces the vectors; it does
 * not decide what belongs with what, because that decision is what every finding downstream is
 * computed from. So the grouping is a pure function with a fixed threshold, fixed tie-breaking and
 * no randomness: the same vectors in the same order produce the same clusters, every run.
 *
 * The algorithm is agglomerative with a similarity floor, in the simplest form that holds that
 * property. Each item joins the existing cluster whose **centroid** it is closest to, if that
 * similarity clears the threshold, and starts its own cluster otherwise. Centroids are recomputed
 * as members arrive.
 *
 * Two properties matter more here than sophistication:
 *
 *   - **Order independence is not claimed.** A single pass is sensitive to input order, so the
 *     caller sorts its input (by URL) before calling, and that sort is what makes the result
 *     stable rather than any property of this function. Saying so here is cheaper than a reader
 *     discovering it from a flaky test later.
 *   - **No k.** Nothing chooses a number of clusters. The data produces however many clear the
 *     threshold, which is why a site about one thing yields one cluster rather than the five
 *     somebody expected to see.
 */

/** Cosine similarity of two vectors, -1..1. Returns 0 for a zero vector rather than NaN. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    normA += x * x
    normB += y * y
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface Clustered<T> {
  members: T[]
  /** The running mean of the members' vectors. Kept so a caller can rank by closeness to it. */
  centroid: number[]
}

/**
 * The similarity two pages need before they count as the same topic.
 *
 * Chosen by looking at real clusters rather than derived: at 0.80 a tile shop's product pages and
 * its delivery policy landed together, and at 0.90 three phrasings of the same service page split
 * into three topics. It is a judgement wearing a number's clothes, which is why it is one named
 * constant with its reasoning attached rather than a magic value inline.
 *
 * It is also model-dependent, as ADR-0024 records: swapping `LLM_EMBED` changes the vectors, so
 * this threshold is calibrated for whatever model produced them.
 */
export const SIMILARITY_THRESHOLD = 0.86

export function clusterByCosine<T>(
  items: readonly { item: T; vector: readonly number[] }[],
  threshold: number = SIMILARITY_THRESHOLD,
): Clustered<T>[] {
  const clusters: { members: T[]; centroid: number[]; count: number }[] = []

  for (const entry of items) {
    let best: (typeof clusters)[number] | undefined
    let bestScore = threshold

    for (const cluster of clusters) {
      const score = cosine(entry.vector, cluster.centroid)
      // Strictly greater, so the first cluster wins a tie. With sorted input that makes ties
      // resolve the same way every run, which is the property the whole file exists for.
      if (score > bestScore) {
        best = cluster
        bestScore = score
      }
    }

    if (!best) {
      clusters.push({ members: [entry.item], centroid: [...entry.vector], count: 1 })
      continue
    }

    // The running mean, updated in place. Recomputing from members would mean holding every
    // vector for the life of the clustering, which on 500 pages is real memory for no gain.
    const next = best.count + 1
    for (let i = 0; i < best.centroid.length; i += 1) {
      best.centroid[i] = ((best.centroid[i] as number) * best.count + (entry.vector[i] ?? 0)) / next
    }
    best.count = next
    best.members.push(entry.item)
  }

  // Largest first: a topic map is read top down, and the biggest share is the thing the site is
  // most about. Equal sizes keep their arrival order, which the caller has already sorted.
  return clusters
    .map((cluster) => ({ members: cluster.members, centroid: cluster.centroid }))
    .sort((a, b) => b.members.length - a.members.length)
}
