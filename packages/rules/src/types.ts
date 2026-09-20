import type { Axis, Effort, Evidence, Finding, Severity } from '@seo/core'
import type { AiCrawlerPosture, CrawledPage, LinkGraph, RobotsTxt, SkippedUrl } from '@seo/crawler'

/**
 * Everything a rule is allowed to look at. Note what is NOT here: no network, no LLM, no
 * clock. A rule is a pure function of the crawl, so the same crawl always yields the same
 * findings, and a rule can be tested against a fixture with nothing else running.
 *
 * This is ADR-0001 expressed as a type signature.
 */
export interface RuleContext {
  siteId: string
  /** The homepage. Click depth and orphan status are measured from here. */
  seed: string
  pages: CrawledPage[]
  robots: RobotsTxt
  posture: AiCrawlerPosture
  /** The site's llms.txt, or null when it has none. */
  llmsTxt: string | null
  /** URLs the sitemap declared, whether or not we reached them. */
  sitemapUrls: string[]
  graph: LinkGraph
  skipped: SkippedUrl[]
  /**
   * The Google Business Profile the client connected, when they have connected one.
   *
   * Configuration rather than observation, and the only thing in this context that is not from
   * the crawl. It is here because the alternative is worse: a rule that checked whether markup
   * links to the right profile would otherwise have to go and look one up, which would put a
   * network call inside a pure function and break ADR-0001 outright. A stored fact passed in
   * keeps every rule a pure function of its input, and a site with no profile connected simply
   * has no value here, so the rules that need one stay silent.
   */
  businessProfile?: { cid?: string | null; placeId?: string | null }
}

/**
 * What a rule hands back. The engine supplies the id, the site, and the status, so a rule
 * cannot forget them and cannot invent them differently from every other rule.
 *
 * `falsification` is not optional, here or anywhere. A rule that cannot say what would
 * prove it wrong does not get to raise a finding.
 */
export interface FindingDraft {
  title: string
  evidence: Evidence
  affectedUrls: string[]
  confidence: number
  estimatedImpact: number
  falsification: string
}

export interface Rule {
  id: string
  axis: Axis
  severity: Severity
  estimatedEffort: Effort
  /** Can a fixer generate a diff for this, or is it advice a human has to act on? */
  fixable: boolean
  /** One line, in plain language, for the findings inbox. */
  description: string
  evaluate: (context: RuleContext) => FindingDraft[]
}

export type { Finding }
