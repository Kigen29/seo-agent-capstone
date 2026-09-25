import { createGitHubApp, githubAppConfigFromEnv } from '@seo/vcs'
import {
  reconcileFixVerifications,
  runAudit,
  pullRequestNumberFrom,
  type MergedFindingRef,
} from '@seo/audit'
import { findings, sites, withTenant, type Database } from '@seo/db'
import type { VerifyFixJob } from '@seo/queue'
import { and, eq, inArray } from 'drizzle-orm'

/** Verification fails closed until coverage and deployment evidence are available. */
export async function runVerifyFix(db: Database, job: VerifyFixJob): Promise<void> {
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

  const merged: (MergedFindingRef & { prUrl: string | null })[] = await withTenant(
    db,
    job.tenantId,
    (tx) =>
      tx
        .select({
          id: findings.id,
          prUrl: findings.prUrl,
          ruleId: findings.ruleId,
          affectedUrls: findings.affectedUrls,
        })
        .from(findings)
        .where(and(eq(findings.siteId, site.id), eq(findings.status, 'merged'))),
  )
  if (merged.length === 0) return

  // Confirm deployment before crawling, so a deployment finishing during the crawl cannot
  // validate observations collected from the previous version.
  const deployed = new Set<string>()
  if (
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
      ? await runAudit(db, { tenantId: job.tenantId, siteId: site.id, seed: site.url })
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

  await withTenant(db, job.tenantId, async (tx) => {
    if (verified.length > 0) {
      await tx.update(findings).set({ status: 'verified' }).where(inArray(findings.id, verified))
    }
    if (inconclusive.length > 0) {
      await tx
        .update(findings)
        .set({
          fixError:
            'Verification inconclusive: successful affected-page coverage and confirmed deployment evidence are required.',
        })
        .where(and(inArray(findings.id, inconclusive), eq(findings.status, 'merged')))
    }
    if (rejected.length > 0) {
      await tx.update(findings).set({ status: 'rejected' }).where(inArray(findings.id, rejected))
    }
  })
  if (inconclusive.length > 0)
    throw new Error('Verification inconclusive; retry after deployment evidence is available.')
}
