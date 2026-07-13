import {
  ALLOW_ALL,
  buildLinkGraph,
  evaluateAiCrawlerPosture,
  extractPage,
  compareRenders,
  parseRobotsTxt,
  toGraphPages,
  type CrawledPage,
} from '@seo/crawler'
import type { RuleContext } from '../src/types.js'

export const ORIGIN = 'https://example.com'
export const u = (path = '/') => `${ORIGIN}${path}`

export interface PageSpec {
  path: string
  html?: string
  status?: number
  redirectChain?: string[]
  finalPath?: string
  headers?: Record<string, string>
  xRobotsTag?: string
  /** Server HTML, when it differs from the rendered DOM. Defaults to the rendered HTML. */
  preJsHtml?: string
  error?: string
}

const doc = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`

export const page = (spec: PageSpec): CrawledPage => {
  const url = u(spec.path)
  const finalUrl = spec.finalPath ? u(spec.finalPath) : url
  const html = spec.html ?? doc('<h1>A page</h1><p>Some words on a page.</p>')
  const preJsHtml = spec.preJsHtml ?? html

  return {
    url,
    finalUrl,
    status: spec.status ?? 200,
    headers: spec.headers ?? {},
    redirectChain: spec.redirectChain?.map((p) => u(p)) ?? [],
    depth: 0,
    fetchedAt: '2026-07-14T09:00:00.000Z',
    preJsHtml,
    renderedHtml: html,
    extract: extractPage(html, finalUrl),
    render: compareRenders(preJsHtml, html, finalUrl),
    xRobotsTag: spec.xRobotsTag,
    error: spec.error,
  }
}

export interface ContextSpec {
  pages: CrawledPage[]
  robotsTxt?: string
  sitemapUrls?: string[]
  seed?: string
}

/**
 * Assemble a RuleContext the way the worker will: from a crawl, a robots.txt, a sitemap,
 * and a link graph derived from the pages themselves. Deriving the graph rather than
 * hand-writing it means the rules are tested against the same graph the product builds.
 */
export const context = (spec: ContextSpec): RuleContext => {
  const robots = spec.robotsTxt === undefined ? ALLOW_ALL : parseRobotsTxt(spec.robotsTxt)
  const seed = spec.seed ?? u('/')

  return {
    siteId: 'site_1',
    seed,
    pages: spec.pages,
    robots,
    posture: evaluateAiCrawlerPosture(robots),
    sitemapUrls: spec.sitemapUrls ?? [],
    graph: buildLinkGraph(toGraphPages(spec.pages), { seed }),
    skipped: [],
  }
}

/** Helpers for building page HTML in one line, so the tests read as the case they test. */
export const html = {
  doc,
  withTitle: (title: string) =>
    doc('<h1>Heading</h1><p>Body text here.</p>', `<title>${title}</title>`),
  withCanonical: (href: string) => doc('<h1>H</h1>', `<link rel="canonical" href="${href}">`),
  noindex: () => doc('<h1>H</h1>', '<meta name="robots" content="noindex">'),
  linkingTo: (...paths: string[]) =>
    doc(`<h1>H</h1>${paths.map((p) => `<a href="${p}">link</a>`).join('')}`),
  headings: (...levels: number[]) => doc(levels.map((l) => `<h${l}>Heading ${l}</h${l}>`).join('')),
  h1s: (count: number) =>
    doc(Array.from({ length: count }, () => '<h1>H</h1>').join('') + '<p>Body.</p>'),
  prose: (words: number, prefix = '') =>
    doc(`<h1>Article</h1><p>${prefix} ${'lorem ipsum dolor sit amet '.repeat(words / 5)}</p>`),
}
