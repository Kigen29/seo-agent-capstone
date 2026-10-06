import type { CrawledPage } from '@seo/crawler'
import { describe, expect, it, vi } from 'vitest'
import {
  clusterByCosine,
  cosine,
  SIMILARITY_THRESHOLD,
  similarityThresholdFor,
} from '../src/cluster.js'
import {
  describePage,
  distinctNames,
  measureTopics,
  ownName,
  pageText,
  type TopicsLlm,
} from '../src/topics.js'

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

describe('pageText: what a page is about, not what every page shares', () => {
  const withMain = (mainText: string): CrawledPage => {
    const base = page('https://ex.com/a', 'Title', 'Home About Contact Quick links PO Box 1')
    return { ...base, extract: { ...base.extract, mainText } } as CrawledPage
  }

  it('reads the opening of the page content, not the menu at the top of the body', () => {
    const text = pageText(withMain('Elephants under Kilimanjaro.'))

    expect(text).toContain('Elephants under Kilimanjaro.')
    expect(text).not.toContain('Quick links')
  })

  it('falls back to the body when a page has no content of its own', () => {
    expect(pageText(withMain(''))).toContain('Quick links')
  })
})

describe('the threshold belongs to the model that produced the vectors', () => {
  it('uses the calibrated value for a model it has one for', () => {
    expect(similarityThresholdFor('openai:text-embedding-3-small')).toEqual({
      threshold: SIMILARITY_THRESHOLD,
      calibrated: true,
    })
  })

  it('has its own value for the Google model, which scores the same pages differently', () => {
    expect(similarityThresholdFor('google:gemini-embedding-001')).toEqual({
      threshold: 0.88,
      calibrated: true,
    })
  })

  it('reads the first target of a chain, since that is the one that answers', () => {
    expect(similarityThresholdFor('openai:text-embedding-3-small, other:model').calibrated).toBe(
      true,
    )
  })

  it('falls back to the default for an unknown model, and says it is a guess', () => {
    expect(similarityThresholdFor('someone:new-embedder')).toEqual({
      threshold: SIMILARITY_THRESHOLD,
      calibrated: false,
    })
    expect(similarityThresholdFor(undefined).calibrated).toBe(false)
  })
})

/**
 * A real audit of a safari operator's site came back with twenty-three topics, fourteen of them
 * called "Safari Tours". The grouping was right; the names were useless.
 */
describe('topic names are different from each other', () => {
  const at = (path: string, h1: string, title = 'Best Kenya Safari Tours'): CrawledPage => {
    const base = page(`https://ex.com${path}`, title, 'text')
    return { ...base, extract: { ...base.extract, h1s: h1 ? [h1] : [] } } as CrawledPage
  }

  it('names a page that stands alone by its own heading, with no model involved', () => {
    expect(ownName(at('/destinations/amboseli', 'Amboseli'))).toBe('Amboseli')
  })

  it('uses the address when the heading is too long to show', () => {
    expect(
      ownName(at('/kenya-safari-faqs', 'Everything you ever wanted to know about going on safari')),
    ).toBe('Kenya safari faqs')
  })

  it('does not name a page after a record id', () => {
    expect(ownName(at('/safaris/82695b94-7ee5-4096-8f69-209348c0ae7b', ''))).toBe(
      'Best Kenya Safari Tours',
    )
    expect(ownName(at('/', ''))).toBe('Homepage')
  })

  it('shows the model each page heading and path, since titles are often shared', () => {
    expect(describePage(at('/hotels-and-lodges/Mara%20Simba', 'Mara Simba Lodge'))).toBe(
      'Mara Simba Lodge (/hotels-and-lodges/Mara Simba)',
    )
  })

  it('tells two groups with one name apart by the section their pages live in', () => {
    const packages = [at('/safaris/a', 'A'), at('/safaris/b', 'B'), at('/', 'Home')]
    const hotels = [at('/hotels-and-lodges/x', 'X'), at('/hotels-and-lodges/y', 'Y')]

    expect(distinctNames(['Safari Tours', 'Safari Tours'], [packages, hotels])).toEqual([
      'Safari Tours: Safaris',
      'Safari Tours: Hotels and lodges',
    ])
  })

  it('numbers what a section cannot separate, largest group first', () => {
    const small = [at('/a', 'A')]
    const large = [at('/b', 'B'), at('/c', 'C')]

    expect(distinctNames(['Safari Tours', 'Safari Tours', 'Birds'], [small, large, small])).toEqual(
      ['Safari Tours (2)', 'Safari Tours', 'Birds'],
    )
  })

  it('leaves names that were already different alone', () => {
    expect(distinctNames(['Tiles', 'Contact'], [[at('/a', 'A')], [at('/b', 'B')]])).toEqual([
      'Tiles',
      'Contact',
    ])
  })

  it('never returns two topics with one name from a whole measurement', async () => {
    const pages = [
      at('/safaris/a', 'Three day Mara safari'),
      at('/safaris/b', 'Five day Mara safari'),
      at('/hotels/x', 'Mara lodge one'),
      at('/hotels/y', 'Mara lodge two'),
      at('/about', 'About'),
    ]
    // Two tight pairs and one page alone.
    const vectors: Record<string, number[]> = {
      '/safaris/a': [1, 0, 0],
      '/safaris/b': [0.99, 0.1, 0],
      '/hotels/x': [0, 1, 0],
      '/hotels/y': [0.1, 0.99, 0],
      '/about': [0, 0, 1],
    }
    const llm: TopicsLlm = {
      embed: async (texts) =>
        texts.map((_, index) => {
          const sorted = [...pages].sort((a, b) => a.finalUrl.localeCompare(b.finalUrl))
          return vectors[new URL(sorted[index]!.finalUrl).pathname]!
        }),
    }
    const asked: number[] = []
    const result = await measureTopics(
      { tenantId: 't', pages, model: 'openai:text-embedding-3-small' },
      llm,
      async (clusters) => {
        asked.push(...clusters.map((c) => c.titles.length))
        return new Map(clusters.map((c) => [c.id, 'Safari Tours']))
      },
    )

    const names = result.map!.clusters.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('About')
    // Only the two real groups were sent to the model; the lone page was not.
    expect(asked).toEqual([2, 2])
  })
})
