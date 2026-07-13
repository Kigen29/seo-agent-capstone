import { describe, expect, it } from 'vitest'
import { pageRank } from '../src/graph/pagerank.js'

const graph = (edges: Record<string, string[]>) =>
  new Map<string, readonly string[]>(Object.entries(edges))

const total = (ranks: Map<string, number>) => [...ranks.values()].reduce((a, b) => a + b, 0)

describe('pageRank', () => {
  it('conserves total rank, which is how you know nothing leaked', () => {
    const ranks = pageRank(graph({ a: ['b'], b: ['c'], c: ['a'] }))

    expect(total(ranks)).toBeCloseTo(1, 5)
  })

  it('splits rank evenly around a symmetric cycle', () => {
    const ranks = pageRank(graph({ a: ['b'], b: ['c'], c: ['a'] }))

    expect(ranks.get('a')).toBeCloseTo(1 / 3, 4)
    expect(ranks.get('b')).toBeCloseTo(1 / 3, 4)
    expect(ranks.get('c')).toBeCloseTo(1 / 3, 4)
  })

  it('ranks a page that everything links to above the pages linking to it', () => {
    const ranks = pageRank(graph({ a: ['hub'], b: ['hub'], c: ['hub'], hub: ['a'] }))

    expect(ranks.get('hub')).toBeGreaterThan(ranks.get('a') ?? 0)
    expect(ranks.get('hub')).toBeGreaterThan(ranks.get('b') ?? 0)
  })

  it('does not leak rank into a dangling page', () => {
    // A page with no outbound internal links absorbs rank and passes none on. Without
    // redistributing that mass, the totals bleed away every iteration and every score is
    // quietly wrong in a way that still looks plausible. This is the classic bug.
    const ranks = pageRank(graph({ a: ['dead'], b: ['dead'], dead: [] }))

    expect(total(ranks)).toBeCloseTo(1, 5)
    expect(ranks.get('dead')).toBeGreaterThan(ranks.get('a') ?? 0)
  })

  it('handles a graph that is entirely dangling', () => {
    const ranks = pageRank(graph({ a: [], b: [] }))

    expect(total(ranks)).toBeCloseTo(1, 5)
    expect(ranks.get('a')).toBeCloseTo(0.5, 5)
  })

  it('gives a page with no inbound links the minimum, not zero', () => {
    // Even an unlinked page keeps the random-jump share. Reporting zero would imply
    // Google cannot reach it, which is a different claim entirely.
    const ranks = pageRank(graph({ a: ['b'], b: ['a'], lonely: ['a'] }))

    expect(ranks.get('lonely')).toBeGreaterThan(0)
    expect(ranks.get('lonely')).toBeLessThan(ranks.get('a') ?? 0)
  })

  it('returns nothing for an empty graph rather than dividing by zero', () => {
    expect(pageRank(new Map())).toEqual(new Map())
  })

  it('is deterministic', () => {
    const edges = graph({ a: ['b', 'c'], b: ['c'], c: ['a'] })

    expect([...pageRank(edges)]).toEqual([...pageRank(edges)])
  })
})
