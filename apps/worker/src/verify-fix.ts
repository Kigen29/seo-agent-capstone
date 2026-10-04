import { createGitHubApp, githubAppConfigFromEnv } from '@seo/vcs'
import {
  reconcileFixVerifications,
  runAudit,
  pullRequestNumberFrom,
  verificationFor,
  type MergedFindingRef,
} from '@seo/audit'
import { asOwner, findings, sites, withTenant, type Database } from '@seo/db'
import { enqueueVerifyFix, type Queue, type VerifyFixJob } from '@seo/queue'
import { and, eq, lt, or, isNull } from 'drizzle-orm'

/** Verification fails closed until coverage and deployment evidence are available. */
export interface VerifyFixDeps {
  isDeployed?: (number: number, siteUrl: string) => Promise<boolean>
  audit?: typeof runAudit
}

export async function runVerifyFix(
  db: Database,
  job: VerifyFixJob,
  deps: VerifyFixDeps = {},
): Promise<void> {
  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: sites.id,
        url: sites.url,
        repoFullName: sites.repoFullName,
        installationId: sites.githubInstallationId,
      })
      .from(sites)
      .where(eq(sites.id, job.siteId))
      .limit(1)
    return row
  })
  if (!site) throw new Error(`Site ${job.siteId} not found.`)

  const merged: (MergedFindingRef & {
    prUrl: string | null
    baseline: (typeof findings.$inferSelect)['baseline']
  })[] = await withTenant(db, job.tenantId, (tx) =>
    tx
      .select({
        id: findings.id,
        prUrl: findings.prUrl,
        ruleId: findings.ruleId,
        affectedUrls: findings.affectedUrls,
        baseline: findings.baseline,
      })
      .from(findings)
      .where(and(eq(findings.siteId, site.id), eq(findings.status, 'merged'))),
  )
  if (merged.length === 0) return
  await withTenant(db, job.tenantId, (tx) =>
    tx
      .update(findings)
      .set({ verificationCheckedAt: new Date() })
      .where(and(eq(findings.siteId, site.id), eq(findings.status, 'merged'))),
  )

  // Confirm deployment before crawling, so a deployment finishing during the crawl cannot
  // validate observations collected from the previous version.
  const deployed = new Set<string>()
  if (deps.isDeployed) {
    for (const finding of merged) {
      const number = pullRequestNumberFrom(finding.prUrl ?? '')
      if (number && (await deps.isDeployed(number, site.url))) deployed.add(finding.id)
    }
  } else if (
    site.repoFullName &&
    site.installationId &&
    process.env.GH_APP_ID &&
    process.env.GH_APP_PRIVATE_KEY
  ) {
    const [owner, name] = site.repoFullName.split('/')
    if (owner && name) {
      const api = await createGitHubApp(githubAppConfigFromEnv()).apiFor({
        repo: { owner, name },
        installationId: site.installationId,
      })
      for (const finding of merged) {
        const number = pullRequestNumberFrom(finding.prUrl ?? '')
        if (number && (await api.isPullRequestDeployed?.(number, site.url)))
          deployed.add(finding.id)
      }
    }
  }
  const result =
    deployed.size > 0
      ? await (deps.audit ?? runAudit)(db, {
          tenantId: job.tenantId,
          siteId: site.id,
          seed: site.url,
          verificationFindings: merged,
        })
      : undefined
  const verdicts = new Map(
    merged.flatMap((finding) => [
      ...reconcileFixVerifications(
        [finding],
        result?.findings ?? [],
        result
          ? { ...result.verificationCoverage, deploymentConfirmed: deployed.has(finding.id) }
          : undefined,
      ),
    ]),
  )

  const verified = [...verdicts].filter(([, v]) => v === 'verified').map(([id]) => id)
  const inconclusive = [...verdicts].filter(([, v]) => v === 'inconclusive').map(([id]) => id)
  const rejected = [...verdicts].filter(([, v]) => v === 'rejected').map(([id]) => id)

  // The record of each decided fix: what was measured before, what after, and in words. Written
  // per finding, in the same transaction as the status, so an outcome never exists without its
  // evidence. Only for findings that were actually re-audited: a decided verdict needs a result.
  const byId = new Map(merged.map((finding) => [finding.id, finding]))
  const recordOf = (id: string, outcome: 'verified' | 'rejected') =>
    verificationFor(byId.get(id)!, outcome, result?.findings ?? [])

  await withTenant(db, job.tenantId, async (tx) => {
    for (const id of verified) {
      await tx
        .update(findings)
        .set({ status: 'verified', fixError: null, verification: recordOf(id, 'verified') })
        .where(eq(findings.id, id))
    }
    for (const id of inconclusive) {
      await tx
        .update(findings)
        .set({
          fixError: deployed.has(id)
            ? 'Deployment confirmed, but the required pages or root files could not be checked completely. The worker will check again; no success is inferred from missing evidence.'
            : 'Waiting for deployment evidence: GitHub must report a successful production deployment containing this pull request merge commit, with an environment URL matching this site. The worker checks again hourly when available.',
        })
        .where(and(eq(findings.id, id), eq(findings.status, 'merged')))
    }
    for (const id of rejected) {
      await tx
        .update(findings)
        .set({ status: 'rejected', fixError: null, verification: recordOf(id, 'rejected') })
        .where(eq(findings.id, id))
    }
  })
  if (inconclusive.length > 0)
    throw new Error('Verification inconclusive; retry after deployment evidence is available.')
}

/** Rebuild checks from durable state after finite queue retries are exhausted. */
export async function enqueuePendingFixVerifications(db: Database, queue: Queue): Promise<number> {
  const due = await asOwner(db, (tx) =>
    tx
      .selectDistinct({ siteId: findings.siteId, tenantId: findings.tenantId })
      .from(findings)
      .where(
        and(
          eq(findings.status, 'merged'),
          or(
            isNull(findings.verificationCheckedAt),
            lt(findings.verificationCheckedAt, new Date(Date.now() - 60 * 60 * 1000)),
          ),
        ),
      ),
  )
  let count = 0
  for (const site of due) {
    try {
      if (await enqueueVerifyFix(queue, site)) count++
    } catch (error) {
      console.warn('Could not schedule pending fix verification', site.siteId, error)
    }
  }
  return count
}
