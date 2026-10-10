import { type CrawlResult, normaliseUrl } from '@seo/crawler'

/** Whether the crawl reached the site at all, and the address it was actually served from. */

/**
 * Refuse to score a site we never actually reached.
 *
 * The crawler records a page it could not fetch as status 0 with an error, rather than
 * throwing, and that is right: one dead page in a hundred must not kill the crawl. But it
 * means an unreachable *seed* produces a crawl that looks successful and contains one dead
 * page, and the rules will happily run over it. They then report, with full confidence,
 * that the site has no sitemap and no canonical tag: perfectly true statements about a
 * server that never answered, and completely worthless.
 *
 * That is the exact failure the scorecard was built to prevent, arriving through the back
 * door. An axis we could not measure reports `not_measured` rather than inventing a number;
 * an audit with no evidence at all must refuse in the same way, and louder. No data is not
 * the same as no problems.
 *
 * A 4xx or 5xx seed is a different thing entirely, and is NOT caught here. A homepage
 * returning 404 is a real, catastrophic finding about a site that genuinely responded, and
 * the rules should absolutely report it.
 */
export function assertSiteWasReachable(
  { pages, skipped }: Pick<CrawlResult, 'pages' | 'skipped'>,
  seed: string,
): void {
  const reachedSomething = pages.some((page) => page.status > 0)
  if (reachedSomething) return

  // A seed the egress policy refused is never fetched, so its reason is on the skip, not a page.
  const why = pages[0]?.error ?? skipped[0]?.reason ?? 'no pages were fetched'

  throw new Error(
    `Could not reach ${seed}: ${why}. No page responded, so there is nothing to audit. ` +
      'Refusing to score a site we never saw.',
  )
}

/**
 * Crawl a site, run the rules over it, score it, and store all of it.
 *
 * This is the whole Sprint 1 loop in one function, and it is the only place the four
 * packages meet: the crawler knows nothing about rules, the rules know nothing about the
 * database, and none of them know about each other. That separation is what lets the rule
 * engine be a pure function tested against fixtures, and it is worth the one composition
 * point that has to know everything.
 *
 * Runs on the worker (a GitHub Actions runner, ADR-0006), never on Vercel: it drives a real
 * Chromium.
 */
/**
 * The address the site's own pages were served from: the final URL of the seed if the crawl
 * followed it there, else of the first page that loaded. Falls back to the seed.
 */
export function servedFrom(
  seed: string,
  pages: readonly { url: string; finalUrl: string; status: number }[],
): string {
  const key = (url: string) => normaliseUrl(url) ?? url
  const home = pages.find((page) => page.status === 200 && key(page.url) === key(seed))
  return (home ?? pages.find((page) => page.status === 200))?.finalUrl ?? seed
}
