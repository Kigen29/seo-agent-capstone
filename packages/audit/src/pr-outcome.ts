import { appendJob, asOwner, findings, sites, type Database } from '@seo/db'
import { and, eq } from 'drizzle-orm'

/**
 * What happened to a pull request we opened, and what that means for the record behind it.
 *
 * This exists because there are now two ways to learn a PR closed, and they must reach identical
 * conclusions. The webhook hears it from GitHub within seconds. The reconciler asks GitHub later,
 * because a webhook delivered to a service that is asleep or mid-deploy is lost and never retried,
 * which is not a hypothetical: PR #24 was merged and the finding behind it sat in `pr_open`
 * indefinitely, and a verification PR merged three weeks earlier left its site unverified the same
 * way.
 *
 * Two code paths applying "merged" differently is the same class of bug as a column disagreeing
 * with the function that computes it, so neither caller gets to write its own version.
 */
export interface PullRequestOutcome {
  merged: boolean
  closed: boolean
}

/** What the reconciler or webhook actually did, so a caller can log it and a test can assert it. */
export type OutcomeEffect = 'merged' | 'reopened' | 'unchanged'

/**
 * Apply a fix PR's outcome only when its stored URL and site connection match the caller's binding.
 *
 * By URL rather than branch: a rule key is only unique within an audit, so two audits of the same
 * site produce two findings whose branches collide. The URL is exact.
 *
 * `asOwner` because neither caller has a tenant: a webhook carries no session, and the reconciler
 * sweeps every tenant at once.
 *
 * Returns what it did rather than nothing, so the reconciler can report a real number instead of
 * claiming to have run.
 */
export async function applyFixPrOutcome(
  db: Database,
  prUrl: string,
  outcome: PullRequestOutcome,
  binding: { repoFullName: string; installationId: number },
  enqueueVerifyFix?: (job: { tenantId: string; siteId: string }) => Promise<unknown>,
): Promise<OutcomeEffect> {
  // Lock the matching finding and site until the transition commits. A disconnect or another
  // delivery cannot change the binding/state between validation and writing the outbox event.
  const result = await asOwner(db, async (tx) => {
    const [finding] = await tx
      .select({
        id: findings.id,
        tenantId: findings.tenantId,
        siteId: findings.siteId,
        status: findings.status,
      })
      .from(findings)
      .innerJoin(sites, and(eq(sites.id, findings.siteId), eq(sites.tenantId, findings.tenantId)))
      .where(
        and(
          eq(findings.prUrl, prUrl),
          eq(sites.repoFullName, binding.repoFullName),
          eq(sites.githubInstallationId, binding.installationId),
        ),
      )
      .limit(1)
      .for('update')

    if (!finding) return { effect: 'unchanged' as const }
    if (outcome.merged) {
      if (finding.status === 'merged' || finding.status === 'verified') {
        return { effect: 'unchanged' as const }
      }
      await tx.update(findings).set({ status: 'merged' }).where(eq(findings.id, finding.id))
      await appendJob(tx, finding.tenantId, `verify-fix:${finding.id}`, 'verify-fix', {
        tenantId: finding.tenantId,
        siteId: finding.siteId,
      })
      return { effect: 'merged' as const, tenantId: finding.tenantId, siteId: finding.siteId }
    }
    if (outcome.closed && finding.status === 'pr_open') {
      await tx
        .update(findings)
        .set({ status: 'open', prUrl: null })
        .where(eq(findings.id, finding.id))
      return { effect: 'reopened' as const }
    }
    return { effect: 'unchanged' as const }
  })
  if (result.effect === 'merged' && enqueueVerifyFix) {
    await enqueueVerifyFix({ tenantId: result.tenantId, siteId: result.siteId })
  }
  return result.effect
}

/**
 * The same, for the Search Console verification PR, which is tracked on the site rather than on a
 * finding and so needs its own record but exactly the same reasoning.
 */
export async function applyVerifyPrOutcome(
  db: Database,
  siteId: string,
  outcome: PullRequestOutcome,
  enqueueConfirmVerify?: (job: { tenantId: string; siteId: string }) => Promise<unknown>,
): Promise<OutcomeEffect> {
  const [site] = await asOwner(db, (tx) =>
    tx
      .select({ tenantId: sites.tenantId, status: sites.gscVerificationStatus })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1),
  )

  if (!site) return 'unchanged'

  if (outcome.merged) {
    if (site.status === 'merged' || site.status === 'verified') return 'unchanged'

    await asOwner(db, async (tx) => {
      await tx.update(sites).set({ gscVerificationStatus: 'merged' }).where(eq(sites.id, siteId))
      await appendJob(tx, site.tenantId, `confirm-verify:${siteId}`, 'confirm-verify', {
        tenantId: site.tenantId,
        siteId,
      })
    })
    if (enqueueConfirmVerify) {
      await enqueueConfirmVerify({ tenantId: site.tenantId, siteId })
    }
    return 'merged'
  }

  if (outcome.closed && site.status === 'pr_open') {
    await asOwner(db, (tx) =>
      tx
        .update(sites)
        .set({ gscVerificationStatus: 'none', gscVerificationPrUrl: null })
        .where(eq(sites.id, siteId)),
    )
    return 'reopened'
  }

  return 'unchanged'
}

/**
 * The pull request number in a GitHub PR URL, or null.
 *
 * The reconciler stores URLs and the API takes numbers, and this is the only place that converts
 * between them. Strict on purpose: anything that is not a github.com pull URL returns null and is
 * skipped, rather than being coerced into a number that would address someone else's PR.
 */
export function pullRequestNumberFrom(url: string): number | null {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)(?:[/?#].*)?$/.exec(url.trim())
  if (!match) return null
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
