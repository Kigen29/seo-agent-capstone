import { CANNIBALISATION_CHECKS, QUESTION_GAP_CHECKS, QUICK_WIN_CHECKS } from '@seo/connectors'
import { type AuditMetrics, buildScorecard, priorityScore } from '@seo/core'
import { buildLinkGraph, crawl, type CrawledPage, toGraphPages } from '@seo/crawler'
import {
  audits,
  type Database,
  findings as findingsTable,
  sites,
  visibilityPrompts,
  withTenant,
} from '@seo/db'
import { canFixFinding } from '@seo/fixers'
import { ruleCoverage, runRules } from '@seo/rules'
import { eq } from 'drizzle-orm'
import { measureAuthority } from './authority.js'
import { earlierFindings, fingerprintAll } from './fingerprint.js'
import { checkDeployedFixes } from './fix-checks.js'
import { measurePerformance } from './performance.js'
import { assertSiteWasReachable, servedFrom } from './run-checks.js'
import { backlinksFromEnv, googleOAuthConfig, serpFromEnv } from './run-providers.js'
import type { AuditResult, RunAuditOptions } from './run-types.js'
import { measureSearch } from './search.js'
import {
  evaluateClusterHubs,
  evaluateQuestionCoverage,
  HUB_CHECKS,
  HUB_MIN_PAGES,
  QUESTION_COVERAGE_CHECKS,
} from './topic-findings.js'
import { measureTopics } from './topics.js'
import { measureVisibility } from './visibility.js'

/**
 * The audit, start to finish: crawl, evaluate, measure, score, store.
 *
 * One procedure, kept whole on purpose. Its steps share the crawl result, the running coverage
 * and the failure handling, and a version cut into ten functions would pass the same dozen
 * values between them. What it depends on lives beside it:
 *
 *   run-types      what a run is given and what it returns
 *   run-providers  the paid data sources, built from the environment and budget-guarded
 *   run-checks     whether the site was reached at all, and where it was served from
 */

export type { AuditResult, RunAuditOptions } from './run-types.js'

/**
 * How often the crawl writes its page count back to the database.
 *
 * Every page would be correct and would also add a network round trip to every page of the
 * crawl, which on a hosted Postgres is a real tax on the thing the user is waiting for. A
 * second is well under the threshold at which a progress bar stops feeling live.
 */
const PROGRESS_INTERVAL_MS = 1_000

export async function runAudit(db: Database, options: RunAuditOptions): Promise<AuditResult> {
  const { tenantId, siteId, seed } = options

  /**
   * Two entry points, one function. When the worker runs a queued job, the API has already
   * created the audit row (status `queued`) and the job carries its id, so we move that row
   * to `crawling` rather than creating a second one, which would leave a phantom queued audit
   * on the dashboard forever. When the CLI runs directly, there is no row yet, so we make one.
   *
   * Either way the row is in `crawling` before the first page is fetched, so the dashboard's
   * live progress has something true to show from the outset.
   */
  const auditId = await withTenant(db, tenantId, async (tx) => {
    if (options.auditId) {
      await tx
        .update(audits)
        .set({ status: 'crawling', startedAt: new Date() })
        .where(eq(audits.id, options.auditId))
      return options.auditId
    }

    const [row] = await tx
      .insert(audits)
      .values({ tenantId, siteId, status: 'crawling' })
      .returning({ id: audits.id })

    if (!row) throw new Error('Could not create the audit row.')
    return row.id
  })

  try {
    let crawled = 0
    let lastWrite = 0

    /**
     * Live progress, which the story asks for by name: "I see live progress, not a spinner."
     * The audit row carries the running page count, so the dashboard can poll one cheap row
     * rather than hold a socket open.
     *
     * Errors here are swallowed on purpose, and that is a deliberate reading of the
     * crawler's contract rather than laziness. A throwing onPage hook aborts the crawl,
     * because the hook exists for persisting results and a crawl that cannot store its
     * results is pointless. But this is not persisting results, it is updating a progress
     * counter. Killing a ten-minute crawl of somebody else's site because a cosmetic
     * counter failed to write would be absurd, and re-crawling to recover it would be rude.
     */
    const onPage = async (_page: CrawledPage) => {
      crawled += 1
      options.onProgress?.(crawled)

      const now = Date.now()
      if (now - lastWrite < PROGRESS_INTERVAL_MS) return
      lastWrite = now

      try {
        await withTenant(db, tenantId, (tx) =>
          tx.update(audits).set({ pagesCrawled: crawled }).where(eq(audits.id, auditId)),
        )
      } catch {
        // Cosmetic. Never abort the crawl for it.
      }
    }

    const result = await crawl(
      {
        seed,
        priorityUrls: options.verificationFindings?.flatMap((finding) => finding.affectedUrls),
        maxPages: options.maxPages ?? 50,
        concurrency: options.concurrency ?? 2,
        egress: options.egress,
        // A verification re-crawl exists to re-check specific findings; outbound links are not
        // among the things it can verify, so it does not spend requests on them.
        ...(options.verificationFindings
          ? { outboundLinkLimit: 0, mobileSampleSize: 0, imageSampleSize: 0 }
          : {}),
      },
      { onPage },
    )

    assertSiteWasReachable(result, seed)

    await withTenant(db, tenantId, (tx) =>
      tx
        .update(audits)
        .set({ status: 'evaluating', pagesCrawled: result.pages.length })
        .where(eq(audits.id, auditId)),
    )

    /**
     * The connected Google Business Profile, read once and handed to the rule engine.
     *
     * The only configuration a rule sees, and it is passed in rather than looked up because a
     * rule that fetched anything would stop being a pure function of the crawl (ADR-0001). A
     * site with no profile connected passes nothing, and the rules that need one stay silent.
     */
    const [profile] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ cid: sites.gbpCid, placeId: sites.gbpPlaceId })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1),
    )

    // Built once: the rule engine reads it, and so does the hub check further down.
    const graphPages = toGraphPages(result.pages)
    const graph = buildLinkGraph(graphPages, { seed })

    const crawlFindings = runRules({
      siteId,
      seed,
      businessProfile: profile,
      pages: result.pages,
      robots: result.robots,
      posture: result.posture,
      llmsTxt: result.llmsTxt,
      sitemapUrls: result.sitemapUrls,
      graph,
      skipped: result.skipped,
      ...(result.outbound ? { outbound: result.outbound } : {}),
      ...(result.mobile ? { mobile: result.mobile } : {}),
      ...(result.images ? { images: result.images } : {}),
    })

    /**
     * The performance axis, from CrUX field data. It is a separate vertical from the crawl
     * rule engine on purpose: its data comes from an API rather than the crawl, and it is
     * measured per-site rather than always. The findings are the same shape and go in the
     * same backlog; the scorecard does not care where a finding came from.
     */
    const performance = await measurePerformance(
      siteId,
      // Where the crawl was actually served from, then what was typed. See measurePerformance.
      [servedFrom(seed, result.pages), seed],
      options.cruxApiKey ?? process.env.GOOGLE_CRUX_API_KEY,
    )

    /**
     * The Search Console step: quick wins, self-competing pages, and questions with no page.
     * Unlike the crawl axes, this reaches into the tenant's own field data (behind their OAuth
     * grant), so it is only available for a connected site whose host matches a verified
     * property. When it is not, the content axis is simply the crawl checks, and that is honest
     * rather than empty.
     *
     * The crawled pages go in because one of those checks compares what the site is asked for
     * against what it has written. Titles and H1s only: this is a subject-coverage test, and
     * handing it the body text would make it a similarity score nobody could check.
     */
    const search = await measureSearch(
      db,
      {
        tenantId,
        siteId,
        siteUrl: seed,
        pages: result.pages.map((page) => ({
          url: page.finalUrl,
          title: page.extract.title,
          h1s: page.extract.h1s,
        })),
      },
      { config: options.googleOAuth ?? googleOAuthConfig() },
    )

    /**
     * What the site is about, measured rather than claimed (ADR-0024).
     *
     * Embeddings group the pages deterministically and a model only labels the groups, so two
     * runs over one crawl produce the same map. Its own step like performance and search: the
     * data comes from a model rather than the crawl, it costs money, and "not measured" has
     * several honest meanings that each say which one applies.
     */
    const topics = await measureTopics(
      {
        tenantId,
        pages: result.pages,
        ...(process.env.LLM_EMBED ? { model: process.env.LLM_EMBED } : {}),
      },
      options.topics,
      options.nameTopics,
    )

    /**
     * The AI-visibility axis, read from the poll window the daily saga has been filling.
     *
     * This one only reads. The polls happen once a day on their own schedule, over days, because
     * a citation is a claim about a distribution and not about one answer (ADR-0015). An audit
     * that polled inline would be a single check, and a single check is exactly the noise the
     * whole axis is built to refuse, so running an audit twice in an afternoon cannot conjure a
     * citation into existence.
     */
    const [site] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({
          competitors: sites.competitors,
          brand: sites.brand,
          mentionExclusions: sites.mentionExclusions,
        })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1),
    )

    const visibility = await measureVisibility(db, {
      tenantId,
      siteId,
      domain: seed,
      competitors: site?.competitors ?? [],
    })

    /**
     * The authority axis, from where the web mentions this brand.
     *
     * Unlike the visibility poll, this one does spend at audit time: a mention footprint is a
     * snapshot rather than a distribution over days, so there is nothing to accumulate and
     * nothing gained by waiting. Every query passes the per-tenant guard first, so an audit run
     * by a tenant at its cap comes back with the axis unmeasured rather than a bill (ADR-0017).
     */
    const authority = await measureAuthority(
      {
        siteId,
        brand: site?.brand ?? null,
        domain: seed,
        competitors: site?.competitors ?? [],
        excluded: site?.mentionExclusions ?? [],
      },
      options.serp ?? serpFromEnv(db, tenantId),
      options.backlinks ?? backlinksFromEnv(db, tenantId),
    )

    /**
     * What the topic map advises (ADR-0035). Two findings, and neither is decided by a model: a
     * group of pages with no hub is counted from the crawl's own links, and a tracked question no
     * page is about is tested against the crawl's own titles and headings.
     *
     * The second needs no embeddings at all, so it runs whether or not the map was measured. The
     * questions are read here rather than taken from the visibility report, which lists only the
     * ones that have been polled.
     */
    const observedAt = new Date().toISOString()
    const prompts = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ prompt: visibilityPrompts.prompt })
        .from(visibilityPrompts)
        .where(eq(visibilityPrompts.siteId, siteId)),
    )
    const crawledOk = result.pages.filter((page) => page.status === 200 && !page.error)

    const hubFindings = topics.map
      ? evaluateClusterHubs({
          siteId,
          clusters: topics.map.clusters,
          graph: graphPages,
          nodes: graph.nodes,
          observedAt,
        })
      : []
    const questionFindings = evaluateQuestionCoverage({
      siteId,
      siteUrl: seed,
      prompts: prompts.map((row) => row.prompt),
      pages: crawledOk.map((page) => ({
        url: page.finalUrl,
        title: page.extract.title,
        h1s: page.extract.h1s,
      })),
      observedAt,
    })

    const found = [
      ...crawlFindings,
      ...performance.findings,
      ...search.findings,
      ...visibility.findings,
      ...authority.findings,
      ...hubFindings,
      ...questionFindings,
    ]

    const coverage = { ...ruleCoverage(), performance: performance.coverage }

    /**
     * The crawl already contributes one check here (can the AI crawlers reach the site at all),
     * and the poll adds one per prompt it has enough history to judge. The two notes read as one
     * sentence pair on purpose: the crawl's says being reachable is the precondition for a
     * citation and not evidence of one, the poll's says what the engines actually did.
     */
    coverage.ai_visibility = {
      checksRun: coverage.ai_visibility.checksRun + visibility.promptsMeasured,
      note: `${coverage.ai_visibility.note ?? ''} ${visibility.note}`.trim(),
    }

    // Authority has no crawl rules behind it at all, so the mention step is the whole axis: its
    // coverage replaces rather than adds to what the rule engine reported (which was zero checks
    // and a note saying a backlink source was missing).
    coverage.authority = authority.coverage

    if (search.measured) {
      // Content is already measured by the crawl rules; the Search Console checks add to it
      // rather than replacing it, so the count grows and the note records that field data fed
      // in. Cannibalisation is counted here and nowhere else, which is why the rule engine's
      // own note says it is measured only when Search Console is connected.
      coverage.content = {
        checksRun:
          coverage.content.checksRun +
          QUICK_WIN_CHECKS +
          CANNIBALISATION_CHECKS +
          QUESTION_GAP_CHECKS,
        note: search.note,
      }
    }

    /**
     * The topic map is described on the structure axis, and counts as a check there only for the
     * advice it can give.
     *
     * The map itself measures how the site's subject matter is distributed and is not a check: a
     * measurement that raises no advice must not inflate a score. The hub check is one, and it is
     * counted only when the map was measured and there was at least one group large enough to
     * have a hub, so a site of unrelated pages is not credited with passing a test it never sat.
     */
    if (topics.map) {
      const hubChecked = topics.map.clusters.some(
        (cluster) => cluster.pages.length >= HUB_MIN_PAGES,
      )
      coverage.structure = {
        checksRun: coverage.structure.checksRun + (hubChecked ? HUB_CHECKS : 0),
        note: `${coverage.structure.note ?? ''} ${topics.coverage.note ?? ''}`.trim(),
      }
    }

    // The question check is on the content axis, and ran only if there were questions to test
    // and pages to test them against.
    if (prompts.length > 0 && crawledOk.length > 0) {
      coverage.content = {
        ...coverage.content,
        checksRun: coverage.content.checksRun + QUESTION_COVERAGE_CHECKS,
      }
    }

    const scorecard = buildScorecard({ siteId, findings: found, coverage })

    /**
     * The figures each axis measured, kept alongside the scorecard rather than only summarised
     * into its coverage note. An axis that did not run this time contributes nothing, which is
     * different from one that ran and found nothing.
     */
    const metrics: AuditMetrics = {
      ...(authority.metrics ? { authority: authority.metrics } : {}),
      ...(search.metrics ? { search: search.metrics } : {}),
      ...(topics.map ? { topics: topics.map } : {}),
    }

    const fingerprints = fingerprintAll(found)

    await withTenant(db, tenantId, async (tx) => {
      if (found.length > 0) {
        /**
         * The same issue as last time is recognised here, once, as the audit is written
         * (ADR-0029). Two things are carried onto the new row. When it was first seen, so an issue
         * open since August does not look new every Monday. And a won't-fix decision, which is a
         * person's answer about the issue rather than about one audit's copy of it, and used to be
         * forgotten on every run.
         *
         * A pull request or a verification is deliberately NOT copied: those belong to the row the
         * pull request was opened for, which the webhook and the verifier find by its URL. The new
         * row is linked to that work when it is read, instead of owning a second copy of it.
         */
        const earlier = await earlierFindings(tx, siteId, [...fingerprints.values()], auditId)

        await tx.insert(findingsTable).values(
          found.map((finding) => {
            const fingerprint = fingerprints.get(finding)!
            const before = earlier.get(fingerprint)
            return {
              tenantId,
              siteId,
              auditId,
              key: finding.id,
              fingerprint,
              ...(before ? { firstSeenAt: before.firstSeenAt } : {}),
              ruleId: finding.ruleId,
              axis: finding.axis,
              severity: finding.severity,
              confidence: finding.confidence,
              title: finding.title,
              evidence: finding.evidence,
              affectedUrls: finding.affectedUrls,
              estimatedEffort: finding.estimatedEffort,
              estimatedImpact: finding.estimatedImpact,
              /**
               * Computed here, with the same exported function the UI sorts by, so the column and
               * the formula cannot disagree. Storing it is what lets the API order and paginate the
               * inbox in SQL instead of loading every finding to discover the first twenty.
               */
              priorityScore: priorityScore(finding),
              falsification: finding.falsification,
              /**
               * Asked of the fixers, not copied from the rule, for the same reason `priorityScore`
               * above is computed rather than stored twice: a column and the code that must honour
               * it cannot be allowed to disagree.
               *
               * A rule declaring `fixable: true` is a statement of intent. Whether a pull request
               * can actually be written is a fact about which fixers exist, and only the registry
               * knows it. Copying the rule's claim meant TECH-013 rows were persisted promising a
               * fix that nothing could write; the button was offered, the job queued, and the user
               * waited for a failure that was certain before they clicked.
               */
              fixable: canFixFinding(finding),
              status: before?.status === 'wontfix' ? ('wontfix' as const) : finding.status,
            }
          }),
        )
      }

      await tx
        .update(audits)
        .set({
          status: 'complete',
          completedAt: new Date(),
          pagesCrawled: result.pages.length,
          scorecard,
          metrics,
        })
        .where(eq(audits.id, auditId))
    })

    return {
      auditId,
      findings: found,
      scorecard,
      pagesCrawled: result.pages.length,
      verificationCoverage: {
        ...(options.verificationFindings
          ? { checks: checkDeployedFixes(result, options.verificationFindings, found, profile) }
          : {}),
        successfulUrls: result.pages
          .filter(
            (page) =>
              page.status === 200 &&
              !page.error &&
              page.extract.metaRobots.index &&
              !(page.xRobotsTag ?? '').toLowerCase().includes('noindex'),
          )
          .flatMap((page) => [page.url, page.finalUrl]),
        // Site-wide and graph rules require additional resource coverage before verification.
        evaluatedRuleIds: [
          'TECH-005',
          'TECH-006',
          'TECH-015',
          'TECH-016',
          'TECH-017',
          'TECH-018',
          'TECH-019',
          'TECH-020',
          'TECH-021',
        ],
      },
    }
  } catch (error) {
    /**
     * Record the failure rather than leaving the audit stuck on 'crawling' forever. A user
     * staring at a progress bar that will never move is worse than being told it broke.
     */
    const message = error instanceof Error ? error.message : String(error)

    await withTenant(db, tenantId, (tx) =>
      tx
        .update(audits)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(audits.id, auditId)),
    ).catch(() => undefined)

    throw error
  }
}
