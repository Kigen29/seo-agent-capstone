import { normaliseUrl, type CrawledPage } from '@seo/crawler'
import { markupEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

/**
 * A static host that serves its own 404 for any path it does not recognise, identified from
 * headers alone. This is deliberately narrow: only hosts whose 404 carries a signal nothing
 * else would plausibly send. `x-vercel-error` is Vercel's own header, set on every edge 404 it
 * generates itself, never on a response an application produced. Netlify does not have an
 * equivalent header, so it is inferred from `server: Netlify` on a 404, which is weaker but
 * still not something an application's own error page would set.
 */
type StaticHost = 'vercel' | 'netlify'

function detectStaticHost(page: CrawledPage): StaticHost | null {
  if (page.status !== 404) return null

  const headers = page.headers
  if (headers['x-vercel-error']) return 'vercel'
  if ((headers['server'] ?? '').toLowerCase().includes('netlify')) return 'netlify'

  return null
}

/** Below this many affected routes, it reads as an ordinary broken link (TECH-010's job). */
const MIN_AFFECTED_ROUTES = 2

/** Example URLs carried in the evidence, capped so the finding stays readable. */
const MAX_EXAMPLE_URLS = 5

/**
 * TECH-022: a client-side router's routes 404 at the host because there is no catch-all rewrite.
 *
 * A single-page app (React, Vue, an SPA build with no server-side routing) works fine in a
 * browser that first loaded the homepage: the router intercepts every click and swaps the DOM,
 * so the address bar changes but no new request ever leaves the tab. The moment somebody opens
 * a deep link directly, or Googlebot requests it, or the tab is refreshed, that is a real HTTP
 * request for a path the static host has never heard of, and with no rewrite rule telling it
 * "serve index.html and let the app's router take it from there", the host's own 404 answers
 * instead. Every inner page is unindexable, and a green Lighthouse run on the homepage never
 * catches it, because Lighthouse never requests the inner routes directly.
 *
 * Fires only when all three hold: the site has a page that is an empty shell before JavaScript
 * runs but renders internal links after it runs (the CSR signal TECH-018 already computes), at
 * least two of the links it renders were crawled directly and came back 404, and those 404s
 * carry a header signal that the static host generated them rather than the application. That
 * last condition is what tells this apart from TECH-010: an ordinary broken link on a
 * server-rendered site, or a 404 the app itself renders with a 200 or an HTML body, is not this
 * rule's business.
 */
export const TECH_022: Rule = {
  id: 'TECH-022',
  axis: 'crawl_health',
  severity: 'critical',
  estimatedEffort: 'trivial',
  fixable: true,
  description:
    'A single-page app has no catch-all rewrite, so its own internal links 404 at the host.',

  evaluate: (context) => {
    const shells = context.pages.filter((page) => page.status === 200 && page.render.likelyCsrOnly)
    if (shells.length === 0) return []

    const byUrl = new Map(
      context.pages.map((page) => [normaliseUrl(page.finalUrl) ?? page.finalUrl, page]),
    )

    // Every internal link a shell page renders once JavaScript has run. A shell with no
    // rendered links has nothing for this rule to check.
    const linkedUrls = new Set<string>()
    for (const shell of shells) {
      for (const link of shell.extract.links) {
        if (!link.internal || !link.resolved) continue
        linkedUrls.add(normaliseUrl(link.resolved) ?? link.resolved)
      }
    }

    const byHost = new Map<StaticHost, CrawledPage[]>()
    for (const url of linkedUrls) {
      const target = byUrl.get(url)
      if (!target) continue // linked but never crawled: nothing observed either way

      const host = detectStaticHost(target)
      if (!host) continue

      const existing = byHost.get(host) ?? []
      existing.push(target)
      byHost.set(host, existing)
    }

    // Report the host with the most affected routes. Two hosts both misconfigured on one site
    // would be extraordinary, and splitting the evidence across two findings for one fix (add a
    // catch-all rewrite) would ask the user to act twice.
    const [host, affected] =
      [...byHost.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? []
    if (!host || !affected || affected.length < MIN_AFFECTED_ROUTES) return []

    const shellUrl = shells[0]!.finalUrl
    const examples = affected.slice(0, MAX_EXAMPLE_URLS)
    const rewriteFile = host === 'vercel' ? 'vercel.json' : 'netlify.toml'

    return [
      {
        title:
          `${affected.length} internal link(s) rendered by ${shellUrl} 404 at the host ` +
          `(${host}), because there is no catch-all rewrite to the app`,
        evidence: markupEvidence(
          shells[0]!,
          'a[href]',
          JSON.stringify({
            host,
            shellUrl,
            affectedCount: affected.length,
            examples: examples.map((page) => ({ url: page.url, status: page.status })),
          }),
        ),
        affectedUrls: [shellUrl, ...affected.map((page) => page.url)],
        confidence: 0.95,
        estimatedImpact: 95,
        falsification:
          'After the fix is deployed, a direct request (no JavaScript) to each affected URL ' +
          `returns 200 with the app's HTML instead of the host's 404. If any affected URL still ` +
          'returns 404 from the host, the fix failed. ' +
          `Fix this with a catch-all rewrite in ${rewriteFile} that serves index.html for every ` +
          'path and lets the client-side router take it from there. Caveat: a catch-all also ' +
          'makes a genuinely missing URL return 200, so a URL the app does not recognise needs ' +
          'the app itself to render a not-found view (and set noindex on it), or every bad link ' +
          'becomes a soft 404 instead of a hard one.',
      },
    ]
  },
}
