import type { AxisCoverage, TopicMap } from '@seo/core'
import type { CrawledPage } from '@seo/crawler'
import { clusterByCosine, SIMILARITY_THRESHOLD } from './cluster.js'

/**
 * What this site is about, measured.
 *
 * The shape ADR-0024 allows: embeddings are the instrument, the grouping is a deterministic
 * function over them, and the model only labels groups that already exist. Every honest failure
 * state degrades to "not measured" with a reason, exactly as the performance and authority axes
 * do, because an empty treemap reads as "this site has no topics" and that is never what happened.
 */

/** The only thing this needs from a model: vectors. `@seo/llm`'s LlmClient satisfies it. */
export interface TopicsLlm {
  embed(texts: string[], tenantId: string): Promise<number[][]>
}

/**
 * Names for clusters, supplied by the caller rather than fetched here.
 *
 * Injected because the prompt lives in `@seo/agent` and this package does not depend on it: apps
 * compose the two, which is how every other LLM call in the product is wired. It is optional in
 * the signature as well as in effect, since a map with fallback names is still a map (ADR-0024).
 */
export type NameClusters = (
  clusters: { id: number; titles: string[] }[],
) => Promise<Map<number, string>>

export interface MeasureTopicsOptions {
  tenantId: string
  pages: CrawledPage[]
  /** Which embedding model produced the vectors, recorded with the result. */
  model?: string
}

export interface TopicsResult {
  measured: boolean
  map?: TopicMap
  coverage: AxisCoverage
}

/**
 * How many pages are embedded.
 *
 * A cost ceiling rather than a technical one. Fifty is the crawl's own default page cap, so on a
 * small site this embeds everything; on a large one it embeds the first fifty by URL and the
 * result says so, which is why `pagesEmbedded` and `pagesCrawled` are both recorded.
 */
export const MAX_EMBEDDED_PAGES = 50

/** The fewest pages worth clustering. Below this a "topic map" is a list with a chart on it. */
const MIN_PAGES = 4

/**
 * The text that represents a page.
 *
 * Title, H1 and the opening prose, not the whole body. A page's subject is announced in its first
 * screen; the rest is navigation, footers and boilerplate that every page on the site shares, and
 * including it makes every page look like every other page. Trimmed to a fixed length so one long
 * article does not dominate a cluster by sheer volume.
 */
const LEAD_CHARACTERS = 600

export function pageText(page: CrawledPage): string {
  const parts = [
    page.extract.title ?? '',
    page.extract.h1s[0] ?? '',
    page.extract.text.slice(0, LEAD_CHARACTERS),
  ]
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

const unmeasured = (note: string): TopicsResult => ({
  measured: false,
  coverage: { checksRun: 0, note },
})

export async function measureTopics(
  options: MeasureTopicsOptions,
  llm?: TopicsLlm,
  nameClusters?: NameClusters,
): Promise<TopicsResult> {
  if (!llm) {
    return unmeasured(
      'Topics are not measured: no embedding model is configured (set LLM_EMBED and a key for ' +
        'its provider). That is an absence of measurement, not a site without topics.',
    )
  }

  /**
   * Sorted by URL before anything else happens, and that sort is load-bearing.
   *
   * The clustering is a single pass and therefore sensitive to input order, so this is what makes
   * two runs over one crawl produce the same clusters. Crawl order is arrival order, which is
   * concurrency-dependent and would quietly make the map unreproducible.
   */
  const usable = options.pages
    .filter((page) => page.status === 200 && !page.error && pageText(page).length > 0)
    .sort((a, b) => a.finalUrl.localeCompare(b.finalUrl))

  if (usable.length < MIN_PAGES) {
    return unmeasured(
      `Topics are not measured: ${usable.length} usable page(s) were crawled, and a topic map ` +
        `over fewer than ${MIN_PAGES} is a list with a chart drawn on it.`,
    )
  }

  const embedded = usable.slice(0, MAX_EMBEDDED_PAGES)

  let vectors: number[][]
  try {
    vectors = await llm.embed(
      embedded.map((page) => pageText(page)),
      options.tenantId,
    )
  } catch {
    // Over budget, no provider, or the provider refused. The audit's other axes are real and this
    // one is simply dark for the run.
    return unmeasured(
      'Topics are not measured this run: the embedding call did not return. The rest of the ' +
        'audit is unaffected.',
    )
  }

  if (vectors.length !== embedded.length) {
    // A short vector list would silently mis-assign pages to other pages' vectors, which is the
    // one failure here that would produce a confident, wrong map rather than no map.
    return unmeasured(
      'Topics are not measured this run: the embedding model returned a different number of ' +
        'vectors than pages sent, so no page could be matched to its own vector with certainty.',
    )
  }

  const clusters = clusterByCosine(
    embedded.map((page, index) => ({ item: page, vector: vectors[index] as number[] })),
  )

  const names = nameClusters
    ? await nameClusters(
        clusters.map((cluster, id) => ({
          id,
          titles: cluster.members.map((page) => page.extract.title ?? page.finalUrl),
        })),
      ).catch(() => new Map<number, string>())
    : new Map<number, string>()

  const map: TopicMap = {
    pagesEmbedded: embedded.length,
    pagesCrawled: options.pages.length,
    ...(options.model ? { model: options.model } : {}),
    clusters: clusters.map((cluster, id) => ({
      // A cluster with no name is not a failure worth hiding: the fallback says what it is made
      // of, which is what a name would have told the reader anyway.
      name: names.get(id) ?? fallbackName(cluster.members),
      share: cluster.members.length / embedded.length,
      pages: cluster.members.map((page) => page.finalUrl),
    })),
  }

  return {
    measured: true,
    map,
    coverage: {
      checksRun: map.clusters.length,
      note:
        `${map.clusters.length} topic(s) across ${embedded.length} of ${options.pages.length} ` +
        `crawled page(s), grouped by similarity above ${SIMILARITY_THRESHOLD} and named ` +
        `afterwards. The grouping is deterministic: the same pages produce the same topics. ` +
        `Shares are of the ${embedded.length} pages measured, not of the whole site.` +
        (names.size === 0
          ? ' The naming call did not return, so each topic is labelled with its own most common words.'
          : ''),
    },
  }
}

/**
 * A name made of the cluster's own most frequent title words.
 *
 * Used when the model is unavailable. Crude on purpose: it is visibly a fallback rather than
 * something a reader would mistake for a considered label.
 */
function fallbackName(pages: readonly CrawledPage[]): string {
  const counts = new Map<string, number>()

  for (const page of pages) {
    for (const word of (page.extract.title ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((part) => part.length > 3)) {
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([word]) => word)

  return top.length > 0 ? top.join(' ') : 'Unnamed topic'
}
