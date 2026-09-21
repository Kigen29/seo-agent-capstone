import type { CrawledPage } from '@seo/crawler'
import { describe, expect, it, vi } from 'vitest'
import { clusterByCosine, cosine } from '../src/cluster.js'
import { measureTopics, pageText, type TopicsLlm } from '../src/topics.js'

/**
 * The tests ADR-0024 rests on.
 *
 * The decision is that a model may produce vectors and may name groups, but may not decide what
 * belongs with what. The assertion that enforces it is reproducibility: run the same measurement
 * twice over the same crawl and the clusters are identical. A model-as-detector implementation
 * cannot pass that, which is what makes this a test of the architecture rather than of arithmetic.
 */

const page = (url: string, title: string, text: string): CrawledPage =>
  ({
    url,
    finalUrl: url,
    status: 200,
    headers: {},
    redirectChain: [],
    depth: 1,
    fetchedAt: '2026-09-21T00:00:00.000Z',
    preJsHtml: '',
    renderedHtml: '',
    extract: { title, h1s: [title], text } as CrawledPage['extract'],
    render: {} as CrawledPage['render'],
  }) as CrawledPage

/**
 * A fake embedder with no model in it.
 *
 * Vectors are derived from the words in the text, so pages about the same thing land near each
 * other and the clustering is exercised for real. Deterministic by construction, which is the
 * point: the test must fail when the *clustering* becomes unstable, not when a model does.
 */
const DIMENSIONS = ['tile', 'carpet', 'delivery', 'blog', 'price', 'about'] as const

const fakeLlm = (): TopicsLlm => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map((text) => {
      const lower = text.toLowerCase()
      const vector = DIMENSIONS.map((word) => (lower.includes(word) ? 1 : 0))
      // A non-zero vector for a page mentioning nothing we know, so cosine stays defined.
      return vector.some(Boolean) ? vector : DIMENSIONS.map(() => 0.1)
    }),
  ),
})

const tiles = [
  page('https://ex.com/a-tile-one', 'Floor tile prices', 'tile price tile price'),
  page('https://ex.com/b-tile-two', 'Wall tile prices', 'tile price tile price'),
  page('https://ex.com/c-tile-three', 'Mosaic tile prices', 'tile price tile'),
]
const carpets = [
  page('https://ex.com/d-carpet-one', 'Carpet delivery', 'carpet delivery carpet'),
  page('https://ex.com/e-carpet-two', 'Carpet fitting', 'carpet delivery'),
]

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns 0 rather than NaN for a zero vector', () => {
    // A page whose embedding came back empty must not poison every comparison with NaN.
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('clusterByCosine', () => {
  it('groups near vectors and separates far ones', () => {
    const clusters = clusterByCosine([
      { item: 'a', vector: [1, 0, 0] },
      { item: 'b', vector: [0.99, 0.1, 0] },
      { item: 'c', vector: [0, 1, 0] },
    ])

    expect(clusters).toHaveLength(2)
    expect(clusters[0]?.members).toEqual(['a', 'b'])
    expect(clusters[1]?.members).toEqual(['c'])
  })

  it('chooses no number of clusters: a site about one thing yields one', () => {
    const clusters = clusterByCosine(
      Array.from({ length: 6 }, (_, i) => ({ item: i, vector: [1, 0.01 * i, 0] })),
    )

    expect(clusters).toHaveLength(1)
  })

  it('puts the largest cluster first, because a topic map is read top down', () => {
    const clusters = clusterByCosine([
      { item: 'lonely', vector: [0, 1, 0] },
      { item: 'a', vector: [1, 0, 0] },
      { item: 'b', vector: [1, 0.01, 0] },
    ])

    expect(clusters[0]?.members).toHaveLength(2)
  })
})

describe('measureTopics', () => {
  const run = (pages: CrawledPage[], llm?: TopicsLlm) =>
    measureTopics({ tenantId: 't1', pages }, llm ?? fakeLlm())

  it('produces the same clusters twice over the same crawl', async () => {
    // The property the whole ADR turns on. Shuffled input, because the ordering that makes this
    // hold is the sort inside measureTopics, not the order the crawler happened to finish in.
    const first = await run([...tiles, ...carpets])
    const second = await run([...carpets].reverse().concat([...tiles].reverse()))

    expect(first.map?.clusters.map((c) => c.pages)).toEqual(
      second.map?.clusters.map((c) => c.pages),
    )
  })

  it('separates two subjects and reports each share of the pages measured', async () => {
    const result = await run([...tiles, ...carpets])

    expect(result.measured).toBe(true)
    expect(result.map?.clusters).toHaveLength(2)
    expect(result.map?.clusters[0]?.share).toBeCloseTo(3 / 5)
    expect(result.map?.pagesEmbedded).toBe(5)
  })

  it('names a cluster from the model, and never lets it invent one', async () => {
    const namer = vi.fn(
      async () =>
        new Map([
          [0, 'Tile prices'],
          [99, 'A group that does not exist'],
        ]),
    )

    const result = await measureTopics(
      { tenantId: 't1', pages: [...tiles, ...carpets] },
      fakeLlm(),
      namer,
    )

    expect(result.map?.clusters[0]?.name).toBe('Tile prices')
    expect(result.map?.clusters.map((c) => c.name)).not.toContain('A group that does not exist')
  })

  it('keeps the map when the naming call fails, and says the names are a fallback', async () => {
    const namer = vi.fn(async () => {
      throw new Error('model unavailable')
    })

    const result = await measureTopics(
      { tenantId: 't1', pages: [...tiles, ...carpets] },
      fakeLlm(),
      namer,
    )

    expect(result.measured).toBe(true)
    expect(result.map?.clusters).toHaveLength(2)
    expect(result.coverage.note).toMatch(/most common words/)
  })

  it('is unmeasured, not empty, with no embedding model configured', async () => {
    const result = await measureTopics({ tenantId: 't1', pages: [...tiles, ...carpets] })

    expect(result.measured).toBe(false)
    expect(result.map).toBeUndefined()
    expect(result.coverage.note).toMatch(/LLM_EMBED/)
  })

  it('refuses to guess when the model returns the wrong number of vectors', async () => {
    // The one failure that would produce a confident, wrong map: pages silently matched to other
    // pages' vectors.
    const short: TopicsLlm = { embed: async () => [[1, 0, 0]] }

    const result = await measureTopics({ tenantId: 't1', pages: [...tiles, ...carpets] }, short)

    expect(result.measured).toBe(false)
    expect(result.coverage.note).toMatch(/different number of/)
  })

  it('does not draw a chart over three pages', async () => {
    expect((await run(tiles)).measured).toBe(false)
  })

  it('ignores pages that failed, and says how many were measured against the crawl', async () => {
    const broken = { ...page('https://ex.com/z', 'Gone', ''), status: 404 } as CrawledPage
    const result = await run([...tiles, ...carpets, broken])

    expect(result.map?.pagesEmbedded).toBe(5)
    expect(result.map?.pagesCrawled).toBe(6)
    expect(result.coverage.note).toMatch(/5 of 6/)
  })
})

describe('pageText', () => {
  it('leads with the title and the first heading, not the whole body', () => {
    const long = page('https://ex.com/a', 'Title', 'x'.repeat(5000))

    expect(pageText(long).startsWith('Title\nTitle\n')).toBe(true)
    // Boilerplate shared by every page would make every page look alike, so the body is trimmed.
    expect(pageText(long).length).toBeLessThan(1000)
  })
})
