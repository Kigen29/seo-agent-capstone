import { siteEvidence } from '../evidence.js'
import type { Rule, RuleContext } from '../types.js'

const now = (context: RuleContext) => context.pages[0]?.fetchedAt ?? new Date().toISOString()

/**
 * AGENT-001: the site has no llms.txt.
 *
 * llms.txt is a root file that lists a site's key pages so an AI agent or crawler can navigate it
 * without guessing. It is agent-readiness infrastructure, and this is the rule that must be most
 * careful about what it claims, because the honest position is a product feature (CLAUDE.md rule 8,
 * and Google's own June 2026 guidance): Google Search ignores llms.txt entirely. So the finding
 * says, in plain language, that adding it helps agents and will not move a Google ranking. A
 * recommendation that implies otherwise is a bug, and a test asserts the disclaimer is present.
 *
 * It is fixable: the agent can generate a well-formed llms.txt from the pages the crawl already
 * found, so the affected URLs carry the site's most-linked pages for the fixer to list.
 */
export const AGENT_001: Rule = {
  id: 'AGENT-001',
  axis: 'agent_readiness',
  severity: 'low',
  estimatedEffort: 'trivial',
  fixable: true,
  description:
    'The site has no llms.txt, the file that helps AI agents navigate it. Not a Google ranking factor.',

  evaluate: (context) => {
    if (context.llmsTxt !== null && context.llmsTxt.trim().length > 0) return []

    // The homepage first, then the most-linked pages, for the fixer to list. Internal inbound
    // links are the site's own vote for what matters, and they come free from the graph.
    const top = [...context.graph.nodes.values()]
      .sort((a, b) => b.inboundCount - a.inboundCount)
      .map((node) => node.url)
    const keyPages = [context.seed, ...top.filter((url) => url !== context.seed)].slice(0, 10)

    return [
      {
        title: `${context.seed} has no llms.txt`,
        evidence: siteEvidence(context.seed, '/llms.txt', '', now(context)),
        affectedUrls: keyPages,
        confidence: 1,
        estimatedImpact: 20,
        falsification:
          'Fetch /llms.txt at the site root. If it returns a non-empty file, this was wrong. Be ' +
          'honest with the user: llms.txt is agent-readiness infrastructure that helps AI agents ' +
          'and crawlers navigate the site, and Google Search ignores it. Expect no Google ranking ' +
          'change from adding it; the benefit is to agents, and that is reason enough.',
      },
    ]
  },
}
