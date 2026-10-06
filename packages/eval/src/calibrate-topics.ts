import { clusterByCosine, cosine, MAX_EMBEDDED_PAGES, pageText } from '@seo/audit'
import type { CrawledPage } from '@seo/crawler'
import { LlmClient } from '@seo/llm'
import { loadDataset } from './dataset.js'
import { toCrawledPage } from './run.js'

/**
 * Calibrate the topic map's similarity threshold for whichever model `LLM_EMBED` names.
 *
 * The threshold is a judgement made by looking at real clusters (see `cluster.ts`), and it is only
 * valid for the model whose vectors it was looked at with: two embedding models put the same pair
 * of pages at very different cosine similarities. So a change of model needs the looking done
 * again, and this is the looking, made repeatable. It embeds the golden dataset's real pages
 * exactly as an audit would, then prints what a person needs to choose a number: how similar
 * pages of one site are to each other, which pairs are closest and furthest, and what the
 * clusters are at each candidate threshold.
 *
 * It prints and decides nothing. A threshold picked by a formula would be the magic number this
 * exists to avoid.
 */

const CANDIDATES = [0.6, 0.65, 0.7, 0.75, 0.8, 0.83, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96]

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[index] as number
}

/** The pages an audit would embed, in the order it would embed them. */
export function embeddable(pages: readonly CrawledPage[]): CrawledPage[] {
  return pages
    .filter((page) => page.status === 200 && !page.error && pageText(page).length > 0)
    .sort((a, b) => a.finalUrl.localeCompare(b.finalUrl))
    .slice(0, MAX_EMBEDDED_PAGES)
}

export interface Pair {
  a: string
  b: string
  similarity: number
}

export function pairwise(pages: readonly CrawledPage[], vectors: readonly number[][]): Pair[] {
  const pairs: Pair[] = []
  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      pairs.push({
        a: pathOf((pages[i] as CrawledPage).finalUrl),
        b: pathOf((pages[j] as CrawledPage).finalUrl),
        similarity: cosine(vectors[i] as number[], vectors[j] as number[]),
      })
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity)
}

/** One line per candidate: how many clusters, and the pages in each that has company. */
export function clustersAt(
  pages: readonly CrawledPage[],
  vectors: readonly number[][],
  threshold: number,
): string[][] {
  return clusterByCosine(
    pages.map((page, index) => ({ item: page, vector: vectors[index] as number[] })),
    threshold,
  ).map((cluster) => cluster.members.map((page) => pathOf(page.finalUrl)))
}

async function main(): Promise<void> {
  const model = process.env.LLM_EMBED
  if (!model) {
    console.error('Set LLM_EMBED to the embedding model to calibrate.')
    process.exitCode = 1
    return
  }
  console.log(`Calibrating the topic threshold for ${model}\n`)

  // No tenant and no database: this is an operator's measurement, capped by the size of the
  // dataset (at most fifty short texts per site), so the budget guard has nothing to protect.
  const llm = new LlmClient(
    async (_tenant, usage) => {
      console.log(`  (${usage.inputTokens} tokens, ~$${usage.estimatedUsd.toFixed(5)})`)
    },
    async () => ({ allowed: true }),
  )

  const fmt = (value: number): string => value.toFixed(3)

  for (const golden of loadDataset()) {
    const pages = embeddable(golden.pages.map((page) => toCrawledPage(page, golden)))
    console.log(`\n=== ${golden.id}: ${pages.length} embeddable page(s)`)
    if (pages.length < 4) {
      console.log('  too few pages to say anything')
      continue
    }

    const vectors = await llm.embed(pages.map(pageText), 'calibration')
    console.log(`  vector length ${vectors[0]?.length ?? 0}`)

    const pairs = pairwise(pages, vectors)
    const values = pairs.map((pair) => pair.similarity).sort((a, b) => a - b)
    console.log(
      `  pairwise similarity over ${pairs.length} pair(s): ` +
        [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
          .map((q) => `p${q * 100}=${fmt(quantile(values, q))}`)
          .join('  '),
    )

    console.log('  closest pairs:')
    for (const pair of pairs.slice(0, 12))
      console.log(`    ${fmt(pair.similarity)}  ${pair.a}  ~  ${pair.b}`)
    console.log('  furthest pairs:')
    for (const pair of pairs.slice(-6))
      console.log(`    ${fmt(pair.similarity)}  ${pair.a}  ~  ${pair.b}`)

    console.log('  clusters at each candidate threshold:')
    for (const threshold of CANDIDATES) {
      const clusters = clustersAt(pages, vectors, threshold)
      const grouped = clusters.filter((members) => members.length > 1)
      console.log(
        `    ${threshold.toFixed(2)}: ${clusters.length} cluster(s), largest ${Math.max(...clusters.map((c) => c.length))}, ` +
          `${clusters.length - grouped.length} alone`,
      )
      for (const members of grouped) console.log(`          [${members.join(', ')}]`)
    }
  }
}

if (process.argv[1]?.endsWith('calibrate-topics.js')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
