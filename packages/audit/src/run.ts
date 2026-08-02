import { buildScorecard, priorityScore, type Finding, type Scorecard } from '@seo/core'
import { buildLinkGraph, crawl, toGraphPages, type CrawledPage } from '@seo/crawler'
import { audits, findings as findingsTable, sites, withTenant, type Database } from '@seo/db'
import {
  budgeted,
  createSerpApiProvider,
  googleOAuthConfigFromEnv,
  QUICK_WIN_CHECKS,
  type OAuthConfig,
  type SerpProvider,
} from '@seo/connectors'
import { createBudgetGuard, recordSpend } from '@seo/budget'
import { ruleCoverage, runRules } from '@seo/rules'
import { eq } from 'drizzle-orm'
import { measurePerformance } from './performance.js'
import { measureSearch } from './search.js'
import { measureVisibility } from './visibility.js'
import { measureAuthority } from './authority.js'

/** The env OAuth config, or undefined when Google is not configured. Never throws. */
function googleOAuthConfig(): OAuthConfig | undefined {
  try {
    return googleOAuthConfigFromEnv()
  } catch {
    return undefined
  }
}

/**
 * A budget-guarded SERP provider from the environment, or undefined when no key is configured.
 *
 * Built here rather than taken as a required dependency so the CLI and the worker both get the
 * paid axes without either of them having to know how a provider is assembled. Undefined is the
 * normal case: this is the only paid dependency in the product and it is off by default, which
 * leaves the authority axis honestly unmeasured rather than silently spending (ADR-0016).
 */
function serpFromEnv(db: Database, tenantId: string): SerpProvider | undefined {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) return undefined

  const guard = createBudgetGuard(db)
  const usd = Number(process.env.SERP_COST_PER_QUERY_USD)

  return budgeted(
    createSerpApiProvider({
      apiKey,
      ...(process.env.SERP_COUNTRY ? { country: process.env.SERP_COUNTRY } : {}),
    }),
    {
      tenantId,
      checkBudget: guard.checkBudget,
      recordSpend: (id, entry) =>
        recordSpend(db, id, {
          kind: 'serp',
          provider: entry.provider,
          model: entry.model,
          micros: entry.micros,
        }),
      // Errs high when unset, which is the safe direction for a cost guard.
      costPerQueryMicros: Math.round((Number.isFinite(usd) && usd > 0 ? usd : 0.015) * 1_000_000),
    },
  )
}

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
  maxPages?: number
  concurrency?: number
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
}

export interface AuditResult {
  auditId: string
  findings: Finding[]
  scorecard: Scorecard
  pagesCrawled: number
}

/**
 * How often the crawl writes its page count back to the database.
 *
 * Every page would be correct and would also add a network round trip to every page of the
 * crawl, which on a hosted Postgres is a real tax on the thing the user is waiting for. A
 * second is well under the threshold at which a progress bar stops feeling live.
 */
const PROGRESS_INTERVAL_MS = 1_000

/**
 * Refuse to score a site we never actually reached.
 *
 * The crawler records a page it could not fetch as status 0 with an error, rather than
 * throwing, and that is right: one dead page in a hundred must not kill the crawl. But it
 * means an unreachable *seed* produces a crawl that looks successful and contains one dead
 * page, and the rules will happily run over it. They then report, with full confidence,
 * that the site has no sitemap and no canonical tag: perfectly true statements about a
 * server that never answered, and completely worthless.
 *
 * That is the exact failure the scorecard was built to prevent, arriving through the back
 * door. An axis we could not measure reports `not_measured` rather than inventing a number;
 * an audit with no evidence at all must refuse in the same way, and louder. No data is not
 * the same as no problems.
 *
 * A 4xx or 5xx seed is a different thing entirely, and is NOT caught here. A homepage
 * returning 404 is a real, catastrophic finding about a site that genuinely responded, and
 * the rules should absolutely report it.
 */
function assertSiteWasReachable(pages: CrawledPage[], seed: string): void {
  const reachedSomething = pages.some((page) => page.status > 0)
  if (reachedSomething) return

  const why = pages[0]?.error ?? 'no pages were fetched'

  throw new Error(
    `Could not reach ${seed}: ${why}. No page responded, so there is nothing to audit. ` +
      'Refusing to score a site we never saw.',
  )
}

/**
 * Crawl a site, run the rules over it, score it, and store all of it.
 *
 * This is the whole Sprint 1 loop in one function, and it is the only place the four
 * packages meet: the crawler knows nothing about rules, the rules know nothing about the
 * database, and none of them know about each other. That separation is what lets the rule
 * engine be a pure function tested against fixtures, and it is worth the one composition
 * point that has to know everything.
 *
 * Runs on the worker (a GitHub Actions runner, ADR-0006), never on Vercel: it drives a real
 * Chromium.
 */
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
      { seed, maxPages: options.maxPages ?? 50, concurrency: options.concurrency ?? 2 },
      { onPage },
    )

    assertSiteWasReachable(result.pages, seed)

    await withTenant(db, tenantId, (tx) =>
      tx
        .update(audits)
        .set({ status: 'evaluating', pagesCrawled: result.pages.length })
        .where(eq(audits.id, auditId)),
    )

    const crawlFindings = runRules({
      siteId,
      seed,
      pages: result.pages,
      robots: result.robots,
      posture: result.posture,
      llmsTxt: result.llmsTxt,
      sitemapUrls: result.sitemapUrls,
      graph: buildLinkGraph(toGraphPages(result.pages), { seed }),
      skipped: result.skipped,
    })

    /**
     * The performance axis, from CrUX field data. It is a separate vertical from the crawl
     * rule engine on purpose: its data comes from an API rather than the crawl, and it is
     * measured per-site rather than always. The findings are the same shape and go in the
     * same backlog; the scorecard does not care where a finding came from.
     */
    const performance = await measurePerformance(
      siteId,
      seed,
      options.cruxApiKey ?? process.env.GOOGLE_CRUX_API_KEY,
    )

    /**
     * Quick wins from Search Console, if this tenant has connected it. Unlike the crawl axes,
     * this reaches into the tenant's own field data (behind their OAuth grant), so it is only
     * available for a connected site whose host matches a verified property. When it is not,
     * the content axis is simply the crawl checks, and that is honest rather than empty.
     */
    const search = await measureSearch(
      db,
      { tenantId, siteId, siteUrl: seed },
      { config: options.googleOAuth ?? googleOAuthConfig() },
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
        .select({ competitors: sites.competitors, brand: sites.brand })
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
      },
      options.serp ?? serpFromEnv(db, tenantId),
    )

    const found = [
      ...crawlFindings,
      ...performance.findings,
      ...search.findings,
      ...visibility.findings,
      ...authority.findings,
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
      // Content is already measured by the crawl rules; the quick wins add to it rather than
      // replacing it, so the check count grows and the note records that Search Console fed in.
      coverage.content = {
        checksRun: coverage.content.checksRun + QUICK_WIN_CHECKS,
        note: search.note,
      }
    }

    const scorecard = buildScorecard({ siteId, findings: found, coverage })

    await withTenant(db, tenantId, async (tx) => {
      if (found.length > 0) {
        await tx.insert(findingsTable).values(
          found.map((finding) => ({
            tenantId,
            siteId,
            auditId,
            key: finding.id,
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
            fixable: finding.fixable,
            status: finding.status,
          })),
        )
      }

      await tx
        .update(audits)
        .set({
          status: 'complete',
          completedAt: new Date(),
          pagesCrawled: result.pages.length,
          scorecard,
        })
        .where(eq(audits.id, auditId))
    })

    return { auditId, findings: found, scorecard, pagesCrawled: result.pages.length }
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
