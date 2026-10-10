import type { BacklinkProvider, OAuthConfig, SerpProvider } from '@seo/connectors'
import type { Finding, Scorecard } from '@seo/core'
import type { EgressPolicy } from '@seo/crawler'
import type { NameClusters, TopicsLlm } from './topics.js'
import type { MergedFindingRef, VerificationCoverage } from './verify-fixes.js'

/** What an audit run is given, and what it returns. */

export interface RunAuditOptions {
  tenantId: string
  siteId: string
  /**
   * An existing audit row to run into, created as `queued` by the API. Omit when running
   * directly from the CLI, and a fresh row is created.
   */
  auditId?: string
  /** The homepage. Click depth and orphan status are measured from here. */
  seed: string
  verificationFindings?: MergedFindingRef[]
  maxPages?: number
  concurrency?: number
  /** Where the crawler may connect. Only tests set this, to reach fixtures on 127.0.0.1. */
  egress?: EgressPolicy
  /** Called on every page, for a caller that wants to print progress to a terminal. */
  onProgress?: (crawled: number) => void
  /** CrUX API key for the performance axis. Falls back to GOOGLE_CRUX_API_KEY. */
  cruxApiKey?: string
  /** Google OAuth config for the Search Console quick-wins step. Falls back to the env. */
  googleOAuth?: OAuthConfig
  /**
   * SERP data source for the authority axis. Falls back to one built from the env, and to no
   * measurement at all when there is no key. Injectable so a test can drive the axis with a fake
   * and no spend.
   */
  serp?: SerpProvider
  /**
   * Backlink index for the authority axis's second signal. Falls back to one built from the env,
   * and to no measurement at all when there are no credentials. Injectable so a test can drive
   * the finding with a fake and no spend.
   */
  backlinks?: BacklinkProvider
  /**
   * The embedding client for the topic map, and the naming call that labels what it measured.
   *
   * Both injected rather than built here, and for different reasons. The client is a paid
   * dependency like every other, so a test drives it with a fake and no spend. The namer lives in
   * `@seo/agent`, which this package does not depend on: apps compose the two, exactly as they do
   * for the content fixer (ADR-0024).
   *
   * Absent means no topic map and a note saying which key is missing, never an empty treemap.
   */
  topics?: TopicsLlm
  nameTopics?: NameClusters
}

export interface AuditResult {
  auditId: string
  findings: Finding[]
  scorecard: Scorecard
  pagesCrawled: number
  verificationCoverage: Omit<VerificationCoverage, 'deploymentConfirmed'>
}
