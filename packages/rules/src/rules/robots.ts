import { isAllowed } from '@seo/crawler'
import { siteEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

const now = (context: { pages: { fetchedAt: string }[] }) =>
  context.pages[0]?.fetchedAt ?? new Date().toISOString()

/**
 * TECH-001: robots.txt blocks a path that matters.
 *
 * Scoped to Googlebot and to pages the site itself declared in its sitemap, which is the
 * site telling us in writing that it wants these indexed. Disallowing a page you put in
 * your own sitemap is a contradiction, and it is nearly always an accident.
 */
export const TECH_001: Rule = {
  id: 'TECH-001',
  axis: 'crawl_health',
  severity: 'critical',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'robots.txt blocks Googlebot from a page the sitemap says should be indexed.',

  evaluate: (context) => {
    if (context.robots.absent) return []

    const homepageBlocked = !isAllowed(context.robots, 'Googlebot', context.seed)

    const blockedSitemapUrls = context.sitemapUrls.filter(
      (url) => !isAllowed(context.robots, 'Googlebot', url),
    )

    if (!homepageBlocked && blockedSitemapUrls.length === 0) return []

    const affected = homepageBlocked ? [context.seed, ...blockedSitemapUrls] : blockedSitemapUrls

    return [
      {
        title: homepageBlocked
          ? 'robots.txt blocks Googlebot from the homepage'
          : `robots.txt blocks Googlebot from ${blockedSitemapUrls.length} page(s) listed in the sitemap`,
        evidence: siteEvidence(
          context.seed,
          '/robots.txt',
          context.robots.groups
            .map(
              (g) =>
                `User-agent: ${g.userAgents.join(', ')}\n${g.rules.map((r) => `${r.type}: ${r.pattern}`).join('\n')}`,
            )
            .join('\n\n'),
          now(context),
        ),
        affectedUrls: [...new Set(affected)],
        confidence: 1,
        estimatedImpact: homepageBlocked ? 100 : 80,
        falsification:
          'Fetch robots.txt and evaluate each affected URL against the Googlebot group. ' +
          'If Googlebot is allowed, this finding was wrong. Also confirm in Search Console: ' +
          'URL Inspection should stop reporting "Blocked by robots.txt".',
      },
    ]
  },
}

/**
 * TECH-002: an AI search crawler is blocked.
 *
 * The most damaging and most common misconfiguration on the web right now. Blocking
 * OAI-SearchBot or PerplexityBot removes the site from ChatGPT and Perplexity answers
 * entirely. Almost nobody who does this meant to: they pasted a 2023 "block the AI
 * scrapers" file and did not know that training crawlers and search crawlers are
 * different things.
 *
 * Deliberately does NOT fire on: blocking training crawlers only (a legitimate choice),
 * Google-Extended (an opt-out token that does not touch Search), or Content-Signals
 * (which express intent and block nothing).
 */
export const TECH_002: Rule = {
  id: 'TECH-002',
  axis: 'ai_visibility',
  severity: 'critical',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'robots.txt blocks the crawlers that make you citable in ChatGPT and Perplexity.',

  evaluate: (context) => {
    const blocked = context.posture.blockedSearchAgents
    if (blocked.length === 0) return []

    const tokens = blocked.map((agent) => agent.token)

    return [
      {
        title: `robots.txt blocks ${tokens.join(' and ')}, removing this site from AI answers`,
        evidence: siteEvidence(
          context.seed,
          '/robots.txt',
          blocked
            .map(
              (agent) =>
                `Disallowed: ${agent.token} (${agent.operator}). ${agent.consequenceIfBlocked}`,
            )
            .join('\n'),
          now(context),
        ),
        affectedUrls: [context.seed],
        confidence: 1,
        estimatedImpact: 95,
        falsification:
          'Re-fetch robots.txt and evaluate each listed agent against it. If the agent is ' +
          'allowed, this finding was wrong. Note the fix is verifiable in robots.txt ' +
          'immediately, but recovery of actual citations is not: re-crawling and ' +
          're-indexing by these engines takes weeks, and a citation is never guaranteed.',
      },
    ]
  },
}
