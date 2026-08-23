import { applyFixPrOutcome, applyVerifyPrOutcome, pullRequestNumberFrom } from '@seo/audit'
import { asOwner, findings, sites, type Database } from '@seo/db'
import { createGitHubApp, githubAppConfigFromEnv, GitHubProvider } from '@seo/vcs'
import { and, eq, isNotNull } from 'drizzle-orm'

/**
 * Ask GitHub what became of every pull request we are still waiting on.
 *
 * The webhook is the fast path and is not a reliable one. GitHub gives a delivery ten seconds and
 * does not keep retrying, and this API runs on an instance that spins down after fifteen minutes
 * of quiet and takes half a minute to wake. A merge that lands in that window is simply never
 * heard, and nothing in the system ever asks again.
 *
 * That is not a theory. When this was written, two records were stuck:
 *
 *   - a TECH-007 finding whose PR was merged, still showing `pr_open`
 *   - a site whose Search Console verification PR was merged three weeks earlier, still `pr_open`,
 *     so the verification it was opened to complete never completed
 *
 * Both are the last two steps of the loop this product exists to close. A polling sweep is a dull
 * fix for that, and dull is correct: the webhook keeps the common case fast, and this makes the
 * outcome eventually true no matter what the network did.
 *
 * Idempotent by construction. It only ever reads records that are still waiting, and
 * `applyFixPrOutcome` refuses to act twice on one that has already moved, so running it every
 * fifteen minutes costs a handful of API calls and changes nothing until something has changed.
 */
export interface ReconcileReport {
  checked: number
  merged: number
  reopened: number
  unchanged: number
  /** PRs we could not read: deleted, or the App lost access. Left alone rather than guessed at. */
  unreadable: number
}

export async function reconcilePullRequests(
  db: Database,
  enqueue: {
    verifyFix?: (job: { tenantId: string; siteId: string }) => Promise<unknown>
    confirmVerify?: (job: { tenantId: string; siteId: string }) => Promise<unknown>
  } = {},
): Promise<ReconcileReport> {
  const provider = new GitHubProvider(createGitHubApp(githubAppConfigFromEnv()).apiFor)
  const report: ReconcileReport = {
    checked: 0,
    merged: 0,
    reopened: 0,
    unchanged: 0,
    unreadable: 0,
  }

  /**
   * Only findings still waiting on a PR. A `merged` finding is already where the webhook or an
   * earlier sweep put it, and re-checking it would grow this query without bound as the product
   * is used.
   *
   * `asOwner` because this sweeps every tenant. It is the one job with no tenant of its own, which
   * is exactly why it reads the tenant off each row and hands it to the enqueue call rather than
   * assuming one.
   */
  const waitingFindings = await asOwner(db, (tx) =>
    tx
      .select({
        prUrl: findings.prUrl,
        siteId: findings.siteId,
        repo: sites.repoFullName,
        installation: sites.githubInstallationId,
      })
      .from(findings)
      .innerJoin(sites, eq(sites.id, findings.siteId))
      .where(and(eq(findings.status, 'pr_open'), isNotNull(findings.prUrl))),
  )

  for (const row of waitingFindings) {
    const outcome = await outcomeFor(provider, row)
    report.checked += 1
    if (!outcome) {
      report.unreadable += 1
      continue
    }
    // An open PR is the expected state for most rows on most sweeps, and means nothing to do.
    if (!outcome.closed && !outcome.merged) {
      report.unchanged += 1
      continue
    }
    const effect = await applyFixPrOutcome(db, row.prUrl!, outcome, enqueue.verifyFix)
    report[effect] += 1
  }

  const waitingSites = await asOwner(db, (tx) =>
    tx
      .select({
        id: sites.id,
        prUrl: sites.gscVerificationPrUrl,
        repo: sites.repoFullName,
        installation: sites.githubInstallationId,
      })
      .from(sites)
      .where(
        and(eq(sites.gscVerificationStatus, 'pr_open'), isNotNull(sites.gscVerificationPrUrl)),
      ),
  )

  for (const row of waitingSites) {
    const outcome = await outcomeFor(provider, row)
    report.checked += 1
    if (!outcome) {
      report.unreadable += 1
      continue
    }
    if (!outcome.closed && !outcome.merged) {
      report.unchanged += 1
      continue
    }
    const effect = await applyVerifyPrOutcome(db, row.id, outcome, enqueue.confirmVerify)
    report[effect] += 1
  }

  return report
}

/**
 * Read one PR, or null when we cannot.
 *
 * Every reason to give up returns null rather than throwing, because one unreadable repository
 * must not abandon the sweep: a customer who uninstalled the App would otherwise stop every other
 * customer's merge from ever being noticed.
 */
async function outcomeFor(
  provider: GitHubProvider,
  row: { prUrl: string | null; repo: string | null; installation: number | null },
): Promise<{ merged: boolean; closed: boolean } | null> {
  if (!row.prUrl || !row.repo || !row.installation) return null

  const number = pullRequestNumberFrom(row.prUrl)
  if (number === null) return null

  const [owner, name] = row.repo.split('/')
  if (!owner || !name) return null

  try {
    return await provider.getPullRequest(
      { repo: { owner, name }, installationId: row.installation },
      number,
    )
  } catch (error) {
    console.error(`reconcile: could not read ${row.prUrl}:`, error)
    return null
  }
}
