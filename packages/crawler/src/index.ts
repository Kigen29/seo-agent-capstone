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

export { extractPage } from './page/extract.js'
export { compareRenders } from './page/render.js'
export type { RenderComparison } from './page/render.js'
export type {
  Heading,
  Hreflang,
  MetaRobots,
  PageExtract,
  PageImage,
  PageLink,
} from './page/types.js'

export { Frontier, normaliseUrl } from './crawl/frontier.js'
export type { FrontierEntry, FrontierOptions, FrontierState } from './crawl/frontier.js'

export { crawl, DEFAULT_USER_AGENT } from './crawl/crawler.js'
export type { CrawlHooks, CrawlOptions } from './crawl/crawler.js'
export { Pacer } from './crawl/pacer.js'
export type { CrawledPage, CrawlResult, SkippedUrl } from './crawl/types.js'

export { expandSitemaps } from './sitemap/expand.js'
export type {
  ExpandedSitemap,
  ExpandOptions,
  SitemapFetcher,
  SitemapProblem,
} from './sitemap/expand.js'
