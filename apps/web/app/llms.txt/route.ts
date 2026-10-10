import { siteUrl } from '@/lib/site'

/**
 * Our own llms.txt.
 *
 * AGENT-001 raises a finding on every site we audit that has none, so ours has one. It is here
 * for the reason that rule gives and no other: an agent that arrives at this site, to answer a
 * question about it or to act on somebody's behalf, gets a short plain-text account of what the
 * product is and where its public pages are, without having to render an application to find
 * out.
 *
 * It is not here to rank. Google's documentation says Search ignores this file, and nothing in
 * it claims otherwise.
 */
export const dynamic = 'force-static'

const BODY = `# RankWright

> An SEO agent that connects to a site's Git repository, audits the site across eight separate areas, and opens pull requests that fix what it finds. A person reviews and merges each one, and the result is rechecked after it is deployed.

RankWright does not produce a single score. It reports eight areas separately: crawl health, performance, content, structure, authority, local, AI visibility and agent readiness. An area that could not be measured says why and is never shown as a zero.

Issues are detected by deterministic checks: a parser, a crawler or an API. A language model is used only to explain a finding and to write its fix. Every finding states, before any fix is written, how you would know the fix had failed.

RankWright never pushes to a main branch, never sends outreach email on anybody's behalf, and does not buy links.

## Public pages

- [Home](${siteUrl}/): what the product does and how the loop works
- [Check one page, free](${siteUrl}/check): paste a web address and see what is wrong with that page, with the evidence. No account
- [Sign in](${siteUrl}/login): the dashboard, which needs an account

## Source

- [Source code](https://github.com/Kigen29/seo-agent-capstone): the whole product is public, including the rule engine and the architecture decision records under docs/adr

## Notes for agents

- Everything under the dashboard needs a signed-in session and is not a public document.
- A free check result at /check/{id} is an audit of somebody else's page, expires after 30 days, and is marked noindex. Do not cite one as a description of RankWright.
`

export function GET(): Response {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
