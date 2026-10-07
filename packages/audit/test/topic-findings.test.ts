import { canFixFinding } from '@seo/fixers'
import { describe, expect, it } from 'vitest'
import {
  evaluateClusterHubs,
  evaluateQuestionCoverage,
  HUB_MIN_PAGES,
} from '../src/topic-findings.js'

/**
 * The two findings the topic map raises (ADR-0035).
 *
 * Both are pure functions of things a person can check without a model: which pages link to which,
 * and which words are in which titles. The tests are written from that side, as the cases where
 * the finding would be wrong and must therefore stay silent.
 */

const SITE = 'https://example.com'
const at = '2026-10-07T00:00:00.000Z'
const url = (path: string) => `${SITE}${path}`

describe('TOPIC-001, a group of pages with no hub', () => {
  const treks = ['/treks/coast', '/treks/forest', '/treks/hills', '/treks/lakes'].map(url)
  const cluster = (pages: string[]) => [{ name: 'Treks', share: 0.4, pages }]

  const run = (pages: string[], links: Record<string, string[]>) =>
    evaluateClusterHubs({
      siteId: 'site',
      clusters: cluster(pages),
      graph: pages.map((page) => ({ url: page, outbound: links[page] ?? [] })),
      nodes: new Map(pages.map((page) => [page, { inboundCount: 1, clickDepth: 2 }])),
      observedAt: at,
    })

  it('raises a group whose pages do not link to each other', () => {
    const [finding, ...rest] = run(treks, {})

    expect(rest).toEqual([])
    expect(finding).toMatchObject({
      ruleId: 'TOPIC-001',
      axis: 'structure',
      severity: 'low',
      fixable: false,
      affectedUrls: treks,
    })
    expect(finding!.title).toBe(
      '4 pages on one subject have no page linking them together: the best connected, ' +
        '/treks/coast, links to 0 of the other 3',
    )
    expect(finding!.evidence).toMatchObject({ kind: 'graph', url: treks[0], clickDepth: 2 })
  })

  it('is silent when one page links to at least half of the others', () => {
    // Two of the other three is a hub by the stated definition.
    expect(run(treks, { [treks[0]!]: [treks[1]!, treks[2]!] })).toEqual([])
  })

  it('still raises it when the best page links to fewer than half', () => {
    const [finding] = run(treks, { [treks[2]!]: [treks[0]!] })

    expect(finding!.title).toContain('/treks/hills, links to 1 of the other 3')
  })

  it('does not count links to pages outside the group, or to itself', () => {
    const [finding] = run(treks, { [treks[0]!]: [treks[0]!, url('/about'), url('/contact')] })

    expect(finding!.title).toContain('links to 0 of the other 3')
  })

  it(`ignores a group of fewer than ${HUB_MIN_PAGES} pages, which has nothing to be a hub of`, () => {
    expect(run(treks.slice(0, HUB_MIN_PAGES - 1), {})).toEqual([])
  })

  it('states a falsification a person can carry out by opening the pages', () => {
    const [finding] = run(treks, {})

    expect(finding!.falsification).toMatch(/count how many of the others it links to/)
    expect(finding!.falsification).toMatch(/at least 2 of them/)
    // The grouping is a model's vectors, and the finding says it can be mistaken.
    expect(finding!.falsification).toMatch(
      /grouping comes from text similarity and can be mistaken/,
    )
    expect(finding!.falsification).toMatch(/no ranking change is promised/)
  })

  it('never puts the cluster name in the finding, because nothing may depend on it', () => {
    const [finding] = run(treks, {})

    expect(JSON.stringify(finding)).not.toContain('Treks')
  })

  it('is not something a fixer claims to be able to write', () => {
    expect(canFixFinding(run(treks, {})[0]!)).toBe(false)
  })
})

describe('TOPIC-002, a tracked question no page is about', () => {
  const pages = [
    { url: url('/'), title: 'Example Treks', h1s: ['Walk with us'] },
    { url: url('/treks'), title: 'Guided walking tours', h1s: ['Small group walking tours'] },
  ]

  const run = (prompts: string[], crawled = pages) =>
    evaluateQuestionCoverage({
      siteId: 'site',
      siteUrl: SITE,
      prompts,
      pages: crawled,
      observedAt: at,
    })

  it('raises a question whose subject appears in no title or main heading', () => {
    const [finding, ...rest] = run(['Is travel insurance included with bookings?'])

    expect(rest).toEqual([])
    expect(finding).toMatchObject({
      ruleId: 'TOPIC-002',
      axis: 'content',
      fixable: false,
      title:
        'No page on the site is about a question you track: "Is travel insurance included with bookings?"',
    })
    expect(finding!.evidence).toMatchObject({ kind: 'markup', locator: 'title, h1' })
  })

  it('is silent when a page covers most of the subject words', () => {
    expect(run(['Which operators run small group walking tours?'])).toEqual([])
  })

  it('reports the same subject once however many ways it is asked', () => {
    const findings = run([
      'Is travel insurance included?',
      'Is insurance for travel included?',
      'travel insurance included',
    ])

    expect(findings).toHaveLength(1)
  })

  it('says nothing when nothing was crawled, because there is nothing to test against', () => {
    expect(run(['Is travel insurance included?'], [])).toEqual([])
  })

  it('skips a question with no subject words, which cannot be tested either way', () => {
    expect(run(['', '   ', 'what is it?'])).toEqual([])
  })

  it('names the words it looked for, and does not promise a citation', () => {
    const [finding] = run(['Is travel insurance included with bookings?'])

    expect(finding!.falsification).toMatch(/covers most of these words: .*insurance/)
    expect(finding!.falsification).toMatch(/is not promised here/)
    expect(finding!.evidence).toMatchObject({
      snippet: expect.stringMatching(/2 crawled page\(s\)/),
    })
  })
})
