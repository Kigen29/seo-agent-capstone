import type { MetadataRoute } from 'next'
import { isProduction, siteUrl } from '@/lib/site'

/**
 * We audit other people's crawl health. Shipping our own site without a robots.txt
 * would be the first thing our own rule engine flagged.
 *
 * Note the AI crawler posture, which is the point of TECH-002: search and retrieval
 * bots (OAI-SearchBot, PerplexityBot) are what make a site citable in ChatGPT and
 * Perplexity. Blocking them by reflex, which is the most common misconfiguration on
 * the web right now, deletes you from those answers. Nothing here names them, so
 * the one rule below admits them.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProduction) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    /*
      Nothing is disallowed, including the `/check/` results that must stay out of the index.

      They used to be disallowed here and marked noindex on the page, and those two cancel: a
      crawler that is told not to fetch a page never reads the tag that tells it not to index
      it, so an address somebody links to can still be listed, bare, from the link alone. To
      keep a page out of the index it has to be fetchable and say noindex. This is the mistake
      our own audit explains to other people (TECH-005 is its sitemap cousin), so it is not one
      to ship. The results still say noindex, expire after 30 days, and are in no sitemap
      (ADR-0025). The signed-in app says noindex too, and redirects anybody without a session.
    */
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
