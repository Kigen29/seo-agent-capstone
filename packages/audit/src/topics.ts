import type { AxisCoverage, TopicMap } from '@seo/core'
import type { CrawledPage } from '@seo/crawler'
import { clusterByCosine, similarityThresholdFor } from './cluster.js'

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
 *
 * The opening is read from the page's own content, not from the top of the body. Measured on real
 * sites, the first 600 characters of a body were the menu followed by the footer, identical on
 * every page, and a contact page and a reviews page scored 0.985 alike.
 */
const LEAD_CHARACTERS = 600

export function pageText(page: CrawledPage): string {
  const parts = [
    page.extract.title ?? '',
    page.extract.h1s[0] ?? '',
    (page.extract.mainText || page.extract.text).slice(0, LEAD_CHARACTERS),
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
    console.log(
      `topics: skipped, ${usable.length} usable page(s) (need ${MIN_PAGES}); no model call`,
    )
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
  } catch (error) {
    // Over budget, no provider, or the provider refused. The audit's other axes are real and this
    // one is simply dark for the run. Say which in the log: from outside, a budget refusal, a bad
    // key and a vendor outage otherwise look identical to a site too small to measure.
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`topics: embedding failed for tenant ${options.tenantId}: ${reason.slice(0, 300)}`)
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

  const { threshold, calibrated } = similarityThresholdFor(options.model)
  const clusters = clusterByCosine(
    embedded.map((page, index) => ({ item: page, vector: vectors[index] as number[] })),
    threshold,
  )

  /**
   * Only groups of two or more go to the model. A page on its own is named by its own heading,
   * which is exact, free, and cannot collide with the name a model gives a neighbouring group.
   * What the model is shown is each page's heading and path, not only its title: on a real site
   * forty pages shared one default title, and every group came back with the same name.
   */
  const toName = clusters
    .map((cluster, id) => ({ id, members: cluster.members }))
    .filter((cluster) => cluster.members.length > 1)
  const modelNames =
    nameClusters && toName.length > 0
      ? await nameClusters(
          toName.map((cluster) => ({ id: cluster.id, titles: cluster.members.map(describePage) })),
        ).catch(() => new Map<number, string>())
      : new Map<number, string>()

  const names = distinctNames(
    clusters.map((cluster, id) =>
      cluster.members.length === 1
        ? ownName(cluster.members[0] as CrawledPage)
        : (modelNames.get(id) ?? fallbackName(cluster.members)),
    ),
    clusters.map((cluster) => cluster.members),
  )

  const map: TopicMap = {
    pagesEmbedded: embedded.length,
    pagesCrawled: options.pages.length,
    ...(options.model ? { model: options.model } : {}),
    clusters: clusters.map((cluster, id) => ({
      // A cluster with no name is not a failure worth hiding: the fallback says what it is made
      // of, which is what a name would have told the reader anyway.
      name: names[id] as string,
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
        `crawled page(s), grouped by similarity above ${threshold} and named ` +
        `afterwards. The grouping is deterministic: the same pages produce the same topics. ` +
        `Shares are of the ${embedded.length} pages measured, not of the whole site.` +
        (calibrated
          ? ''
          : ' That threshold has not been calibrated for this embedding model, so treat the grouping as provisional.') +
        (toName.length > 0 && modelNames.size === 0
          ? ' The naming call did not return, so each topic is labelled with its own most common words.'
          : ''),
    },
  }
}

/** Longest name the map can show. */
const MAX_NAME = 40

const pathOf = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return url
  }
}

/** `/hotels-and-lodges/Mara%20Simba` -> `Mara Simba`. Empty for the homepage. */
function humanise(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  // A record id names a row, not a subject.
  if (!words || /^[0-9a-f ]{16,}$/i.test(words) || /^\d+$/.test(words)) return ''
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const clip = (text: string): string =>
  text.length <= MAX_NAME ? text : `${text.slice(0, MAX_NAME - 1).trimEnd()}\u2026`

/** What the naming model is shown for one page: its heading, and where it lives. */
export function describePage(page: CrawledPage): string {
  const heading = page.extract.h1s[0]?.trim() || page.extract.title?.trim() || ''
  const path = pathOf(page.finalUrl)
  return heading ? `${heading} (${path})` : path
}

/** The name of a page that is a topic by itself: its heading, else its address, else its title. */
export function ownName(page: CrawledPage): string {
  const heading = page.extract.h1s[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (heading && heading.length <= MAX_NAME) return heading

  const segments = pathOf(page.finalUrl).split('/').filter(Boolean)
  const fromPath = humanise(segments[segments.length - 1] ?? '')
  if (fromPath) return clip(fromPath)
  if (segments.length === 0) return 'Homepage'

  return clip(heading || page.extract.title?.replace(/\s+/g, ' ').trim() || 'Unnamed topic')
}

/** The section most of a group's pages live under, as words. Empty when there is no majority. */
function commonSection(pages: readonly CrawledPage[]): string {
  const counts = new Map<string, number>()
  for (const page of pages) {
    // A section is a folder with pages in it. A top-level page is not its own section.
    const segments = pathOf(page.finalUrl).split('/').filter(Boolean)
    const first = segments.length > 1 ? (segments[0] as string) : ''
    counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return top && top[1] * 2 > pages.length ? humanise(top[0]) : ''
}

/**
 * Make every topic's name different from every other's.
 *
 * Two groups with one name read as a mistake, and on a site about one subject a model will
 * happily call every group by that subject. Nothing depends on a name (ADR-0024), so telling them
 * apart is done here, in code, the same way every run: first by the section of the site a group's
 * pages mostly live under, and if that does not separate them, by a number in size order.
 */
export function distinctNames(
  names: readonly string[],
  members: readonly (readonly CrawledPage[])[],
): string[] {
  const result = [...names]
  const key = (name: string): string => name.toLowerCase()

  const groups = new Map<string, number[]>()
  result.forEach((name, index) => {
    groups.set(key(name), [...(groups.get(key(name)) ?? []), index])
  })

  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue
    for (const index of indexes) {
      const section = commonSection(members[index] ?? [])
      const base = result[index] as string
      if (section && key(section) !== key(base)) result[index] = clip(`${base}: ${section}`)
    }
  }

  // Whatever still collides is numbered, largest group first, ties by position.
  const seen = new Map<string, number>()
  const order = result
    .map((_, index) => index)
    .sort((a, b) => (members[b]?.length ?? 0) - (members[a]?.length ?? 0) || a - b)
  const taken = new Set<string>()
  for (const index of order) {
    const base = result[index] as string
    let name = base
    while (taken.has(key(name))) {
      const next = (seen.get(key(base)) ?? 1) + 1
      seen.set(key(base), next)
      name = `${base} (${next})`
    }
    taken.add(key(name))
    result[index] = name
  }

  return result
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
