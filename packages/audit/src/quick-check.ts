import { buildScorecard, type Finding, type Scorecard } from '@seo/core'
import { publicFetch, UnsafeUrlError, type PublicFetchOptions } from '@seo/connectors'
import {
  ALLOW_ALL,
  buildLinkGraph,
  compareRenders,
  evaluateAiCrawlerPosture,
  extractPage,
  parseRobotsTxt,
  parseSitemap,
  toGraphPages,
  type CrawledPage,
} from '@seo/crawler'
import { ALL_RULES, ruleCoverage, runRules } from '@seo/rules'

/**
 * One page, checked without an account (ADR-0025).
 *
 * The same rule engine the authenticated audit runs, over a much smaller observation: one URL, its
 * robots.txt, its sitemap and its llms.txt, fetched through the SSRF guard and parsed. No crawl,
 * no browser, no link graph worth the name, and no tenant data anywhere near it.
 *
 * The honesty problem this has to solve is the opposite of the usual one. A thin check finds fewer
 * problems than a real audit, and a reader who is not told that will read "3 issues" as a clean
 * bill of health. So the coverage notes are rewritten here to say what was *not* looked at, and
 * every axis the check cannot reach reports itself unmeasured rather than scoring well by default.
 */

export interface QuickCheckResult {
  url: string
  /** Where the URL ended up after redirects, which is what was actually checked. */
  finalUrl: string
  status: number
  findings: Finding[]
  scorecard: Scorecard
  /** What a real audit would have looked at and this did not. Rendered under the scorecard. */
  limitations: string[]
}

/** The site id a check reports under. It is not a site; nothing is stored against a tenant. */
const ANONYMOUS_SITE = 'public-check'

/**
 * Rules that cannot say anything true about a single served page.
 *
 * Each one needs something this check does not have, and a rule that "passes" because its input
 * was missing is worse than one that did not run: it makes a thin check look like a clean site.
 *
 *   - TECH-018 compares the served HTML against the rendered DOM, and there is no browser here.
 *   - The structure rules (orphans, click depth) describe a link graph, and one page is not one.
 *   - The duplication rules compare pages against each other.
 */
const SKIPPED_RULES = new Set(['TECH-018', 'TECH-011', 'TECH-012', 'TECH-013', 'TECH-014'])

export interface QuickCheckOptions {
  /** Injected for tests, so the whole check runs with no network. */
  fetch?: typeof globalThis.fetch
  /**
   * DNS resolution, injected alongside the fetch.
   *
   * Both, or the test is not hermetic: `publicFetch` resolves the hostname before it fetches, so
   * a stubbed fetch alone still sends a real lookup for whatever domain the test names.
   */
  resolve?: PublicFetchOptions['resolve']
}

/** What gets handed to the guard: the injected transport, or nothing and it uses the platform's. */
const guardOptions = (options: QuickCheckOptions): PublicFetchOptions => ({
  ...(options.fetch ? { fetch: options.fetch } : {}),
  ...(options.resolve ? { resolve: options.resolve } : {}),
})

/** Fetch a companion file (robots.txt, sitemap, llms.txt), or null when it is not there. */
async function companion(
  origin: string,
  path: string,
  options: QuickCheckOptions,
): Promise<string | null> {
  try {
    const result = await publicFetch(`${origin}${path}`, {
      ...guardOptions(options),
      maxBytes: 500_000,
      timeoutMs: 5_000,
    })
    return result.status === 200 ? result.body : null
  } catch {
    // A missing robots.txt is a finding the rules make, not an error the check reports. Anything
    // else here (a timeout, a refusal) also leaves the file absent, which the rules already
    // handle as its own case.
    return null
  }
}

export async function runQuickCheck(
  input: string,
  options: QuickCheckOptions = {},
): Promise<QuickCheckResult> {
  const page = await publicFetch(input, guardOptions(options))

  if (page.status >= 400) {
    throw new UnsafeUrlError(
      `That URL answered ${page.status}, so there was nothing to check. Try the address a visitor ` +
        'would use.',
    )
  }

  const origin = new URL(page.finalUrl).origin
  const [robotsTxt, llmsTxt, sitemapXml] = await Promise.all([
    companion(origin, '/robots.txt', options),
    companion(origin, '/llms.txt', options),
    companion(origin, '/sitemap.xml', options),
  ])

  /**
   * The served HTML stands in for both the served and the rendered DOM.
   *
   * Not a shortcut: it is what "no browser" means, and it is why TECH-018 is skipped rather than
   * evaluated against two identical strings, which would report every JavaScript-only site as
   * fine.
   */
  const crawled: CrawledPage = {
    url: input,
    finalUrl: page.finalUrl,
    status: page.status,
    headers: page.headers,
    redirectChain: page.chain.length > 1 ? page.chain : [],
    depth: 0,
    fetchedAt: new Date().toISOString(),
    preJsHtml: page.body,
    renderedHtml: page.body,
    extract: extractPage(page.body, page.finalUrl),
    render: compareRenders(page.body, page.body, page.finalUrl),
    ...(page.headers['x-robots-tag'] ? { xRobotsTag: page.headers['x-robots-tag'] } : {}),
  }

  const robots = robotsTxt === null ? ALLOW_ALL : parseRobotsTxt(robotsTxt)

  // A sitemap index points at more sitemaps, and following them would be a crawl. It counts as
  // "a sitemap exists" and nothing more, which is all this check claims.
  const sitemap = sitemapXml === null ? null : parseSitemap(sitemapXml)
  const sitemapUrls = sitemap?.kind === 'urlset' ? sitemap.urls.map((entry) => entry.loc) : []

  const findings = runRules(
    {
      siteId: ANONYMOUS_SITE,
      seed: page.finalUrl,
      pages: [crawled],
      robots,
      posture: evaluateAiCrawlerPosture(robots),
      llmsTxt,
      // Only the URLs the check actually saw. A sitemap of 400 URLs would otherwise make TECH-004
      // report 399 unreachable pages, every one of them an artefact of not having crawled.
      sitemapUrls: sitemapUrls.filter((url) => url === page.finalUrl),
      graph: buildLinkGraph(toGraphPages([crawled]), { seed: page.finalUrl }),
      skipped: [],
    },
    { rules: checkableRules() },
  )

  return {
    url: input,
    finalUrl: page.finalUrl,
    status: page.status,
    findings,
    scorecard: buildScorecard({ siteId: ANONYMOUS_SITE, findings, coverage: checkCoverage() }),
    limitations: [
      `One page was checked, not the site. A full audit crawls up to 50 and compares them, which ` +
        `is how duplicate titles, orphan pages and click depth are found.`,
      'No browser ran, so nothing here can tell you whether the page renders without JavaScript.',
      sitemapUrls.length > 0
        ? `The sitemap lists ${sitemapUrls.length} URL(s). None of them were fetched, so a broken ` +
          `entry would not show up here.`
        : 'No sitemap was found at /sitemap.xml.',
      'Core Web Vitals and Search Console data need a connected account, so performance and ' +
        'search are not measured at all.',
    ],
  }
}

/**
 * The rules that can say something true about one served page.
 *
 * Derived by subtraction from the real registry rather than listed, so a rule added to the engine
 * is included here automatically. The alternative, an allow-list, would silently leave every new
 * rule out of the public check and nobody would notice for a sprint.
 */
function checkableRules() {
  return ALL_RULES.filter((rule) => !SKIPPED_RULES.has(rule.id))
}

/**
 * Coverage for a check, which is mostly a list of what it did not do.
 *
 * Deliberately harsher than the audit's. The scorecard is the same component a signed-in user
 * sees, and the difference between "we checked this and it is fine" and "we could not check this"
 * is the whole reason that component takes notes rather than scores alone.
 */
function checkCoverage() {
  const coverage = ruleCoverage()

  for (const axis of ['performance', 'authority', 'ai_visibility', 'local'] as const) {
    coverage[axis] = {
      checksRun: axis === 'ai_visibility' || axis === 'local' ? coverage[axis].checksRun : 0,
      note:
        axis === 'performance'
          ? 'Not measured. Core Web Vitals come from real Chrome users over 28 days, which needs a ' +
            'connected account.'
          : axis === 'authority'
            ? 'Not measured. Mentions and referring domains need a paid data source and a brand name.'
            : axis === 'ai_visibility'
              ? 'Barely measured: only whether AI crawlers are allowed to reach the page, which is ' +
                'the precondition for being cited and not evidence of it.'
              : 'Partially measured from one page. Google Business Profile and directory ' +
                'consistency need a connected account.',
    }
  }

  coverage.structure = {
    checksRun: 1,
    note:
      'Partially measured. Structured data on this one page is checked; orphan pages and click ' +
      'depth describe a link graph, which needs a crawl.',
  }

  coverage.content = {
    checksRun: coverage.content.checksRun - 2,
    note:
      'Partially measured from one page. Duplicate and near-duplicate content compare pages ' +
      'against each other, and cannibalisation needs Search Console.',
  }

  return coverage
}

/** What a page says about itself: enough to describe the business, nothing more. */
export interface PageSummary {
  title: string | null
  description: string | null
  headings: string[]
}

/**
 * Fetch one page through the SSRF guard and read its title, description and top headings.
 *
 * Used to ground the AI-visibility prompt suggestions in what the site actually says. Served HTML
 * only, no browser: for a client-rendered site that is often just the title and description, which
 * is still the business describing itself. Returns null when the page cannot be read, because a
 * suggestion made without it is still useful and this should never be the reason one fails.
 */
export async function summarisePage(
  input: string,
  options: QuickCheckOptions = {},
): Promise<PageSummary | null> {
  try {
    const page = await publicFetch(input, { ...guardOptions(options), timeoutMs: 8_000 })
    if (page.status >= 400) return null
    const extract = extractPage(page.body, page.finalUrl)
    return {
      title: extract.title,
      description: extract.metaDescription,
      headings: extract.headings
        .filter((heading) => heading.level <= 2)
        .map((heading) => heading.text.trim())
        .filter(Boolean)
        .slice(0, 15),
    }
  } catch {
    return null
  }
}
