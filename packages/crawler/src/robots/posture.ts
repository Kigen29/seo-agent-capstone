import { AI_AGENTS, type AgentCategory, type AiAgent } from './agents.js'
import { isAllowed } from './match.js'
import type { RobotsTxt } from './parse.js'

export interface AgentVerdict {
  agent: AiAgent
  allowed: boolean
}

export interface AiCrawlerPosture {
  verdicts: AgentVerdict[]
  /**
   * Search and retrieval crawlers that are blocked. Non-empty means the site has
   * removed itself from ChatGPT and Perplexity answers, which is a critical finding
   * and is almost never what anyone intended.
   */
  blockedSearchAgents: AiAgent[]
  blockedTrainingAgents: AiAgent[]
  /**
   * The specific, damning pattern: training crawlers are blocked AND search crawlers
   * are blocked too. That is the signature of a copy-pasted "block the AI scrapers"
   * robots.txt whose author did not know the two are different things.
   */
  looksLikeCopyPastedAiBlock: boolean
}

const blockedIn = (verdicts: AgentVerdict[], category: AgentCategory): AiAgent[] =>
  verdicts.filter((v) => !v.allowed && v.agent.category === category).map((v) => v.agent)

/**
 * Evaluate the site's posture towards every AI agent we know about.
 *
 * Checked against `/` because that is the question that matters: can this crawler
 * read the site at all? A site that allows OAI-SearchBot everywhere except /admin is
 * not blocking it in any sense worth raising a critical finding over.
 */
export function evaluateAiCrawlerPosture(robots: RobotsTxt): AiCrawlerPosture {
  const verdicts: AgentVerdict[] = AI_AGENTS.map((agent) => ({
    agent,
    allowed: isAllowed(robots, agent.token, '/'),
  }))

  const blockedSearchAgents = blockedIn(verdicts, 'search')
  const blockedTrainingAgents = blockedIn(verdicts, 'training')

  return {
    verdicts,
    blockedSearchAgents,
    blockedTrainingAgents,
    looksLikeCopyPastedAiBlock: blockedSearchAgents.length > 0 && blockedTrainingAgents.length > 0,
  }
}
