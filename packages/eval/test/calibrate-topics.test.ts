import type { CrawledPage } from '@seo/crawler'
import { describe, expect, it } from 'vitest'
import { clustersAt, embeddable, pairwise, quantile } from '../src/calibrate-topics.js'

/**
 * The calibration prints what a person reads to choose a threshold, so what matters is that the
 * numbers it prints are the ones an audit would have produced: the same pages, in the same order,
 * through the same clustering.
 */
const page = (path: string, text: string, status = 200): CrawledPage =>
  ({
    finalUrl: `https://www.example.com${path}`,
    status,
    extract: { title: text, h1s: [], text },
  }) as unknown as CrawledPage

describe('embeddable', () => {
  it('keeps what an audit would embed: live pages with text, sorted by address', () => {
    const pages = [page('/b', 'b'), page('/gone', 'x', 404), page('/a', 'a'), page('/empty', '')]

    expect(embeddable(pages).map((p) => p.finalUrl)).toEqual([
      'https://www.example.com/a',
      'https://www.example.com/b',
    ])
  })
})

describe('pairwise', () => {
  it('lists every pair once, closest first, by path', () => {
    const pages = [page('/a', 'a'), page('/b', 'b'), page('/c', 'c')]
    const pairs = pairwise(pages, [
      [1, 0],
      [1, 0],
      [0, 1],
    ])

    expect(pairs).toHaveLength(3)
    expect(pairs[0]).toMatchObject({ a: '/a', b: '/b' })
    expect(pairs[0]!.similarity).toBeCloseTo(1)
    expect(pairs[2]!.similarity).toBeCloseTo(0)
  })
})

describe('clustersAt', () => {
  it('groups by the threshold it is given, not the default', () => {
    const pages = [page('/a', 'a'), page('/b', 'b')]
    const vectors = [
      [1, 0],
      [0.8, 0.6],
    ]

    expect(clustersAt(pages, vectors, 0.7)).toEqual([['/a', '/b']])
    expect(clustersAt(pages, vectors, 0.9)).toEqual([['/a'], ['/b']])
  })
})

describe('quantile', () => {
  it('reads the ends and the middle of a sorted list', () => {
    const sorted = [0.1, 0.2, 0.3, 0.4, 0.5]

    expect(quantile(sorted, 0)).toBe(0.1)
    expect(quantile(sorted, 0.5)).toBe(0.3)
    expect(quantile(sorted, 1)).toBe(0.5)
  })
})
