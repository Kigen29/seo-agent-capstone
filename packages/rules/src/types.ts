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
  /** URLs the sitemap declared, whether or not we reached them. */
  sitemapUrls: string[]
  graph: LinkGraph
  skipped: SkippedUrl[]
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
