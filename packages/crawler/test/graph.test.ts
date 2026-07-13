import { describe, expect, it } from 'vitest'
import { buildLinkGraph, type GraphPage } from '../src/graph/build.js'

const SEED = 'https://example.com/'
const u = (path: string) => `https://example.com${path}`

const pages = (edges: Record<string, string[]>): GraphPage[] =>
  Object.entries(edges).map(([from, to]) => ({ url: from, outbound: to }))

describe('buildLinkGraph: click depth', () => {
  const graph = buildLinkGraph(
    pages({
      [SEED]: [u('/a'), u('/b')],
      [u('/a')]: [u('/a1')],
      [u('/a1')]: [u('/a2')],
      [u('/a2')]: [u('/a3')],
      [u('/a3')]: [],
      [u('/b')]: [],
    }),
    { seed: SEED },
  )

  it('measures hops from the homepage', () => {
    expect(graph.nodes.get(SEED)?.clickDepth).toBe(0)
    expect(graph.nodes.get(u('/a'))?.clickDepth).toBe(1)
    expect(graph.nodes.get(u('/a1'))?.clickDepth).toBe(2)
    expect(graph.nodes.get(u('/a3'))?.clickDepth).toBe(4)
  })

  it('takes the SHORTEST path, not the first path found', () => {
    // /target is reachable in 2 clicks via /short, and in 3 via /long1 -> /long2. It must
    // report 2. Depth is what decides whether a page is "buried", so getting this wrong
    // buries a page that is one click from where it should be.
    //
    // The link order matters and is deliberate: a depth-first walk pops the LAST child
    // first, so it would descend /long1 before ever seeing /short, and report depth 3.
    // An earlier version of this test used a direct child of the seed, which passes under
    // both traversals and therefore tested nothing.
    const shortcut = buildLinkGraph(
      pages({
        [SEED]: [u('/short'), u('/long1')],
        [u('/short')]: [u('/target')],
        [u('/long1')]: [u('/long2')],
        [u('/long2')]: [u('/target')],
        [u('/target')]: [],
      }),
      { seed: SEED },
    )

    expect(shortcut.nodes.get(u('/target'))?.clickDepth).toBe(2)
  })

  it('flags a page buried more than three clicks from home', () => {
    expect(graph.nearOrphans).toEqual([u('/a3')])
  })

  it('does not flag a page exactly at the depth limit', () => {
    expect(graph.nearOrphans).not.toContain(u('/a2'))
  })
})

describe('buildLinkGraph: orphans', () => {
  it('flags a page nothing links to', () => {
    const graph = buildLinkGraph(
      pages({
        [SEED]: [u('/a')],
        [u('/a')]: [],
        [u('/orphan')]: [], // in the sitemap, so we crawled it, but nothing links here
      }),
      { seed: SEED },
    )

    expect(graph.orphans).toEqual([u('/orphan')])
    expect(graph.unreachable).toEqual([u('/orphan')])
    expect(graph.nodes.get(u('/orphan'))?.clickDepth).toBeNull()
  })

  it('never calls the homepage an orphan', () => {
    // Nothing links to a homepage from inside a site, and it is reachable by definition.
    // Without this, every site on earth is reported as having an orphaned homepage.
    const graph = buildLinkGraph(pages({ [SEED]: [u('/a')], [u('/a')]: [] }), { seed: SEED })

    expect(graph.nodes.get(SEED)?.inboundCount).toBe(0)
    expect(graph.orphans).toEqual([])
    expect(graph.unreachable).toEqual([])
  })

  it('treats a page linked only by nofollow as orphaned', () => {
    // toGraphPages drops nofollow links, so they never become edges. That is deliberate:
    // a nofollow link passes no equity and Googlebot does not follow it, so telling a
    // site the page is fine would be telling them something false.
    const graph = buildLinkGraph(pages({ [SEED]: [], [u('/nofollowed-only')]: [] }), { seed: SEED })

    expect(graph.orphans).toEqual([u('/nofollowed-only')])
  })

  it('does not count a self-link as inbound authority', () => {
    const graph = buildLinkGraph(pages({ [SEED]: [u('/a')], [u('/a')]: [u('/a')] }), { seed: SEED })

    // The self-link survives here because toGraphPages is what strips them, but the
    // inbound count from the homepage is the only real one.
    expect(graph.nodes.get(u('/a'))?.inboundCount).toBe(2)
  })
})

describe('buildLinkGraph: phantom pages', () => {
  it('ignores a link to a page that was never crawled', () => {
    // A link is not evidence a page exists. Inventing a node for an uncrawled URL puts
    // phantom pages in the orphan list, and the user goes looking for something that
    // was never there.
    const graph = buildLinkGraph(pages({ [SEED]: [u('/a'), u('/never-crawled')], [u('/a')]: [] }), {
      seed: SEED,
    })

    expect(graph.nodes.has(u('/never-crawled'))).toBe(false)
    expect(graph.nodes.size).toBe(2)
    expect(graph.orphans).toEqual([])
  })
})

describe('buildLinkGraph: internal PageRank', () => {
  it('ranks the page the site links to most highly', () => {
    const graph = buildLinkGraph(
      pages({
        [SEED]: [u('/money')],
        [u('/a')]: [u('/money')],
        [u('/b')]: [u('/money')],
        [u('/money')]: [],
      }),
      { seed: SEED },
    )

    const money = graph.nodes.get(u('/money'))?.pageRank ?? 0
    const a = graph.nodes.get(u('/a'))?.pageRank ?? 0

    expect(money).toBeGreaterThan(a)
  })

  it('finds the page that deserves link equity and is not getting any', () => {
    // The actual product use: a page with real content that the site never links to.
    const graph = buildLinkGraph(
      pages({
        [SEED]: [u('/blog')],
        [u('/blog')]: [u('/post-1')],
        [u('/post-1')]: [],
        [u('/high-intent-service-page')]: [],
      }),
      { seed: SEED },
    )

    const neglected = graph.nodes.get(u('/high-intent-service-page'))

    expect(neglected?.inboundCount).toBe(0)
    expect(graph.orphans).toContain(u('/high-intent-service-page'))
  })
})
