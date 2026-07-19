import { reconcileFixVerifications, runAudit, type MergedFindingRef } from '@seo/audit'
import { findings, sites, withTenant, type Database } from '@seo/db'
import type { VerifyFixJob } from '@seo/queue'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Verify a site's merged fixes by re-auditing.
 *
 * When a fix PR is merged, the finding moves to `merged` and this runs: it re-crawls and
 * re-scores the whole site, then reconciles every finding still awaiting verification against the
 * fresh findings. A finding that no longer reproduces is `verified`; one that still fires is
 * `rejected`. That is the finding's own falsification condition, executed: a parser re-checks, not
 * a language model (ADR-0001).
 *
 * The merged findings are gathered after the re-audit, not before, so a fix that merged while the
 * crawl was running is still picked up by this run rather than stranded. A throw fails the job,
 * which the drain retries; verification only means something once the deploy is live, so a
 * too-early run that still reproduces simply records `rejected` and a later merge re-triggers it.
 */
export async function runVerifyFix(db: Database, job: VerifyFixJob): Promise<void> {
  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: sites.id, url: sites.url })
      .from(sites)
      .where(eq(sites.id, job.siteId))
      .limit(1)
    return row
  })
  if (!site) throw new Error(`Site ${job.siteId} not found.`)

  // Re-audit the site. This crawls, re-runs the rules, and stores a fresh audit and its findings,
  // which is exactly the post-merge state we verify against.
  const result = await runAudit(db, { tenantId: job.tenantId, siteId: site.id, seed: site.url })

  // Gather the findings awaiting verification after the crawl, so any that merged during it count.
  const merged: MergedFindingRef[] = await withTenant(db, job.tenantId, (tx) =>
    tx
      .select({
        id: findings.id,
        ruleId: findings.ruleId,
        affectedUrls: findings.affectedUrls,
      })
      .from(findings)
      .where(and(eq(findings.siteId, site.id), eq(findings.status, 'merged'))),
  )
  if (merged.length === 0) return

  const verdicts = reconcileFixVerifications(merged, result.findings)

  const verified = [...verdicts].filter(([, v]) => v === 'verified').map(([id]) => id)
  const rejected = [...verdicts].filter(([, v]) => v === 'rejected').map(([id]) => id)

  await withTenant(db, job.tenantId, async (tx) => {
    if (verified.length > 0) {
      await tx.update(findings).set({ status: 'verified' }).where(inArray(findings.id, verified))
    }
    if (rejected.length > 0) {
      await tx.update(findings).set({ status: 'rejected' }).where(inArray(findings.id, rejected))
    }
  })
}
