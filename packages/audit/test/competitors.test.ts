import { describe, expect, it } from 'vitest'
import { diffSnapshots, MAX_NEW_URLS } from '../src/competitors/diff.js'
import { citationWindows } from '../src/competitors/report.js'
import {
  MAX_WATCHED_PAGES,
  takeSnapshot,
  type CompetitorSnapshot,
} from '../src/competitors/snapshot.js'

/**
 * Competitor watch, held to the story's falsification: the product may say that one thing
 * followed another, and may never say that one caused the other. Most of that is enforced by what
 * these functions refuse to compute, so the tests are mostly about refusals.
 */

const HOST = 'rival.example.com'

const page = (path: string, title: string, description = 'About us', h1 = 'Welcome') => ({
  url: `https://${HOST}${path}`,
  title,
  description,
  h1,
})

const snapshot = (over: Partial<CompetitorSnapshot> = {}): CompetitorSnapshot => ({
  pages: [page('/', 'Rival'), page('/pricing', 'Pricing')],
  sitemapUrls: [`https://${HOST}/`, `https://${HOST}/pricing`],
  note: null,
  ...over,
})

describe('diffSnapshots', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffSnapshots(snapshot(), snapshot())).toEqual([])
  })

  it('reports a changed title with both sides', () => {
    const after = snapshot({ pages: [page('/', 'Rival'), page('/pricing', 'Plans and pricing')] })

    expect(diffSnapshots(snapshot(), after)).toEqual([
      {
        kind: 'title',
        url: `https://${HOST}/pricing`,
        before: 'Pricing',
        after: 'Plans and pricing',
      },
    ])
  })

  it('reports description and H1 changes separately, and a removed element as null', () => {
    const after = snapshot({
      pages: [
        { url: `https://${HOST}/`, title: 'Rival', description: 'Now with tours', h1: null },
        page('/pricing', 'Pricing'),
      ],
    })

    expect(diffSnapshots(snapshot(), after).map((change) => [change.kind, change.after])).toEqual([
      ['description', 'Now with tours'],
      ['h1', null],
    ])
  })

  it('does not call a page changed because it was read this week and not last', () => {
    const after = snapshot({ pages: [...snapshot().pages, page('/about', 'About')] })

    expect(diffSnapshots(snapshot(), after)).toEqual([])
  })

  it('reports URLs that are new to their sitemap', () => {
    const after = snapshot({ sitemapUrls: [...snapshot().sitemapUrls, `https://${HOST}/safaris`] })

    expect(diffSnapshots(snapshot(), after)).toEqual([
      { kind: 'new_url', url: `https://${HOST}/safaris`, before: null, after: null },
    ])
  })

  it('does not call every URL new the first time a sitemap is seen', () => {
    // New to us, not new to them. Reporting it would be the product inventing a launch.
    expect(diffSnapshots(snapshot({ sitemapUrls: [] }), snapshot())).toEqual([])
  })

  it('caps new URLs, because a relaunch is not fifty thousand pieces of news', () => {
    const many = Array.from({ length: MAX_NEW_URLS + 30 }, (_, i) => `https://${HOST}/p/${i}`)
    const after = snapshot({ sitemapUrls: [...snapshot().sitemapUrls, ...many] })

    expect(diffSnapshots(snapshot(), after)).toHaveLength(MAX_NEW_URLS)
  })

  it('reports nothing against a week that could not be read', () => {
    // The refusal that matters most: an outage must not read as "they changed everything".
    const unread = snapshot({ pages: [], sitemapUrls: [], note: 'did not answer' })

    expect(diffSnapshots(unread, snapshot())).toEqual([])
    expect(diffSnapshots(snapshot(), unread)).toEqual([])
  })
})

describe('citationWindows', () => {
  const detectedAt = new Date('2026-10-08T06:00:00.000Z')
  const check = (polledOn: string, ...cited: string[]) => ({ polledOn, citedCompetitors: cited })

  it('counts a competitor either side of the change, with the sample', () => {
    const windows = citationWindows(
      [
        check('2026-10-02', HOST),
        check('2026-10-05'),
        check('2026-10-07'),
        check('2026-10-08', HOST),
        check('2026-10-10', HOST),
        check('2026-10-14'),
      ],
      HOST,
      detectedAt,
    )

    expect(windows).toEqual({
      before: { cited: 1, checks: 3 },
      after: { cited: 2, checks: 3 },
    })
  })

  it('puts the day of the change in the after window, and stops at the window edge', () => {
    const windows = citationWindows(
      [check('2026-09-30', HOST), check('2026-10-01', HOST), check('2026-10-15', HOST)],
      HOST,
      detectedAt,
    )

    // 30 Sept is eight days before and 15 Oct is seven days after: both outside.
    expect(windows).toEqual({ before: { cited: 1, checks: 1 }, after: { cited: 0, checks: 0 } })
  })

  it('counts another competitor being cited as a check, not as a citation', () => {
    const windows = citationWindows([check('2026-10-09', 'other.example.com')], HOST, detectedAt)

    expect(windows.after).toEqual({ cited: 0, checks: 1 })
  })

  it('reports zero checks as zero checks, so the page can say there was nothing to compare', () => {
    expect(citationWindows([], HOST, detectedAt)).toEqual({
      before: { cited: 0, checks: 0 },
      after: { cited: 0, checks: 0 },
    })
  })
})

describe('takeSnapshot', () => {
  const resolve = (async () => [{ address: '93.184.216.34', family: 4 }]) as never

  const html = (title: string, h1: string) =>
    `<html><head><title>${title}</title><meta name="description" content="  Tours\n  and   treks "></head><body><h1>${h1}</h1></body></html>`

  /** A competitor's site as a map of path to body. Anything else answers 404. */
  const site = (pages: Record<string, string>) => {
    const requested: string[] = []
    const fetch = (async (input: string | URL | Request) => {
      const { pathname } = new URL(String(input))
      requested.push(pathname)
      const body = pages[pathname]
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body, { status: 200 })
    }) as unknown as typeof globalThis.fetch
    return { fetch, requested }
  }

  const sitemap = (...paths: string[]) =>
    `<urlset>${paths.map((path) => `<url><loc>https://${HOST}${path}</loc></url>`).join('')}</urlset>`

  it('reads the homepage and sitemap pages, tidying whitespace', async () => {
    const { fetch } = site({
      '/': html('Rival', 'Welcome'),
      '/pricing': html('Pricing', 'What it costs'),
      '/sitemap.xml': sitemap('/', '/pricing'),
    })

    const result = await takeSnapshot(HOST, { fetch, resolve })

    expect(result.note).toBeNull()
    expect(result.sitemapUrls).toEqual([`https://${HOST}/`, `https://${HOST}/pricing`])
    expect(result.pages).toEqual([
      { url: `https://${HOST}/`, title: 'Rival', description: 'Tours and treks', h1: 'Welcome' },
      {
        url: `https://${HOST}/pricing`,
        title: 'Pricing',
        description: 'Tours and treks',
        h1: 'What it costs',
      },
    ])
  })

  it('stays out when their robots.txt asks it to, and reads nothing', async () => {
    const { fetch, requested } = site({
      '/': html('Rival', 'Welcome'),
      '/robots.txt': 'User-agent: *\nDisallow: /',
    })

    const result = await takeSnapshot(HOST, { fetch, resolve })

    expect(result.pages).toEqual([])
    expect(result.note).toMatch(/robots\.txt asks crawlers like ours to stay out/)
    expect(requested).toEqual(['/robots.txt'])
  })

  it('never reads more than the cap, however large their sitemap', async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `/p${i}`)
    const { fetch } = site({
      '/': html('Rival', 'Welcome'),
      '/sitemap.xml': sitemap('/', ...paths),
      ...Object.fromEntries(paths.map((path) => [path, html(path, path)])),
    })

    const result = await takeSnapshot(HOST, { fetch, resolve })

    expect(result.pages).toHaveLength(MAX_WATCHED_PAGES)
    // The whole list is still recorded: it is what next week's new URLs are measured against.
    expect(result.sitemapUrls).toHaveLength(41)
  })

  it('records a site that did not answer as a note, not as an empty site', async () => {
    const { fetch } = site({})

    const result = await takeSnapshot(HOST, { fetch, resolve })

    expect(result.pages).toEqual([])
    expect(result.note).toMatch(/did not answer/)
  })

  it('ignores sitemap entries on another host', async () => {
    const { fetch } = site({
      '/': html('Rival', 'Welcome'),
      '/sitemap.xml': `<urlset><url><loc>https://${HOST}/</loc></url><url><loc>https://elsewhere.example.org/x</loc></url></urlset>`,
    })

    const result = await takeSnapshot(HOST, { fetch, resolve })

    expect(result.sitemapUrls).toEqual([`https://${HOST}/`])
  })
})
