export { AI_AGENTS, SEARCH_AGENTS, agentsByCategory } from './robots/agents.js'
export type { AgentCategory, AiAgent } from './robots/agents.js'

export { ALLOW_ALL, parseRobotsTxt } from './robots/parse.js'
export type {
  ContentSignals,
  RobotsGroup,
  RobotsRule,
  RobotsTxt,
  RuleType,
} from './robots/parse.js'

export { crawlDelayFor, isAllowed, selectGroup } from './robots/match.js'

export { evaluateAiCrawlerPosture } from './robots/posture.js'
export type { AgentVerdict, AiCrawlerPosture } from './robots/posture.js'

export { MAX_SITEMAP_BYTES, MAX_URLS_PER_SITEMAP, parseSitemap } from './sitemap/parse.js'
export type { Sitemap, SitemapUrl } from './sitemap/parse.js'

export { expandSitemaps } from './sitemap/expand.js'
export type {
  ExpandedSitemap,
  ExpandOptions,
  SitemapFetcher,
  SitemapProblem,
} from './sitemap/expand.js'
