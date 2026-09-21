import type { MetadataRoute } from 'next'
import { isProduction, siteUrl } from '@/lib/site'

/**
 * We audit other people's crawl health. Shipping our own site without a robots.txt
 * would be the first thing our own rule engine flagged.
 *
 * Note the AI crawler posture, which is the point of TECH-002: search and retrieval
 * bots (OAI-SearchBot, PerplexityBot) are what make a site citable in ChatGPT and
 * Perplexity. Blocking them by reflex, which is the most common misconfiguration on
 * the web right now, deletes you from those answers.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProduction) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    /*
      `/check/` results are disallowed, and the page that creates them is not. A result is an
      unsolicited audit of somebody else's website, created by whoever pasted the URL; publishing
      those under our domain would be a different product from the one we are advertising
      (ADR-0025). The pages also carry a noindex meta tag, because robots.txt asks and a meta tag
      tells.
    */
    rules: [{ userAgent: '*', allow: '/', disallow: '/check/' }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
