import { createGitHubApp, githubAppConfigFromEnv } from '@seo/vcs'
import { HostingConnectionError, siteHosting } from './hosting.js'
import {
  liveCheckDue,
  MERGE_SETTLED_HOURS,
  mergeSettled,
  reconcileFixVerifications,
  runAudit,
  pullRequestNumberFrom,
  verificationFor,
  type MergedFindingRef,
} from '@seo/audit'
import {
  asOwner,
  findings,
  fixAttempts,
  sites,
  hostingConnections,
  withTenant,
  type Database,
} from '@seo/db'
import { enqueueVerifyFix, type Queue, type VerifyFixJob } from '@seo/queue'
import { and, eq, inArray, lt, max, or, isNull } from 'drizzle-orm'

/**
 * Check whether merged fixes worked, on the live site.
 *
 * A deployment report from the host is used when there is one, because it says when to look. When
 * there is none, the live site is looked at anyway (ADR-0047). This used to wait for the report
 * and never look without it, which for a host that sends no reports meant every fix stayed on
 * "merged, checking" for good, and the loop this product exists for never closed.
 */
export interface VerifyFixDeps {
  isDeployed?: (number: number, siteUrl: string) => Promise<boolean>
  audit?: typeof runAudit
  /** Injected by tests, in place of the clock. */
  now?: Date
}

/**
 * How a note about a live look begins. The words are also a marker: a merged finding whose note
 * does not start this way has never been looked at on the live site, and is looked at now.
 */
export const LIVE_CHECK_NOTE = 'Checked the live site'

const stamp = (moment: Date) =>
  `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(moment)} UTC`

/** Why a deployment report could not be read, in words safe to show. Never the provider's own. */
function evidenceProblem(error: unknown): string {
  if (error instanceof HostingConnectionError) return error.message
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
  if (status === 403) {
    return 'GitHub denied deployment evidence access. Check the GitHub App installation, its repository Deployments read permission, and GitHub rate limits.'
  }
  if (status === 401) {
    return 'GitHub authentication failed while reading deployment evidence. Check the GitHub App credentials and installation access.'
  }
  return 'Deployment evidence could not be read. Check GitHub or hosting availability and integration access.'
}

export async function runVerifyFix(
  db: Database,
  job: VerifyFixJob,
  deps: VerifyFixDeps = {},
): Promise<void> {
  const now = deps.now ?? new Date()
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
    fixError: string | null
    previousCheckAt: Date | null
  })[] = await withTenant(db, job.tenantId, (tx) =>
    tx
      .select({
        id: findings.id,
        prUrl: findings.prUrl,
        ruleId: findings.ruleId,
        affectedUrls: findings.affectedUrls,
        baseline: findings.baseline,
        fixError: findings.fixError,
        previousCheckAt: findings.verificationCheckedAt,
      })
      .from(findings)
      .where(and(eq(findings.siteId, site.id), eq(findings.status, 'merged'))),
  )
  if (merged.length === 0) return

  // When each pull request was merged, which is what "long enough ago" is counted from.
  const mergedAt = new Map(
    (
      await withTenant(db, job.tenantId, (tx) =>
        tx
          .select({ findingId: fixAttempts.findingId, at: max(fixAttempts.resolvedAt) })
          .from(fixAttempts)
          .where(
            and(
              inArray(
                fixAttempts.findingId,
                merged.map((finding) => finding.id),
              ),
              eq(fixAttempts.prResolution, 'merged'),
            ),
          )
          .groupBy(fixAttempts.findingId),
      )
    ).map((row) => [row.findingId, row.at]),
  )

  await withTenant(db, job.tenantId, (tx) =>
    tx
      .update(findings)
      .set({ verificationCheckedAt: now })
      .where(and(eq(findings.siteId, site.id), eq(findings.status, 'merged'))),
  )

  // Ask for deployment evidence before crawling, so a deployment finishing during the crawl
  // cannot validate observations collected from the previous version.
  const deployed = new Set<string>()
  let hostingRevision: string | null = null
  let evidenceNote: string | null = null
  try {
    const hosting = await siteHosting(db, job.tenantId, site)
    hostingRevision = hosting.revision
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
        const api = await createGitHubApp({
          ...githubAppConfigFromEnv(),
          deploymentLookup: hosting.deploymentLookup,
        }).apiFor({
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
  } catch (error) {
    // A report that cannot be read is the same as no report: look at the site. The reason is
    // kept for the note, in words of our own and never the provider's.
    evidenceNote = evidenceProblem(error)
  }

  /**
   * Look at the live site when a deployment is confirmed, and otherwise on a spaced schedule.
   *
   * A look is a crawl and a row in the audit history, so without a report it is not every hour.
   * A finding never looked at before is looked at now, which is what unsticks the fixes that
   * were waiting for a report that was never going to come.
   */
  const dueWithoutEvidence = merged.some(
    (finding) =>
      !deployed.has(finding.id) &&
      (!finding.fixError?.startsWith(LIVE_CHECK_NOTE) ||
        liveCheckDue(mergedAt.get(finding.id) ?? null, finding.previousCheckAt, now)),
  )
  if (deployed.size === 0 && !dueWithoutEvidence) return

  const result = await (deps.audit ?? runAudit)(db, {
    tenantId: job.tenantId,
    siteId: site.id,
    seed: site.url,
    verificationFindings: merged,
  })
  const settled = (id: string) => mergeSettled(mergedAt.get(id) ?? null, now)
  const verdicts = new Map(
    merged.flatMap((finding) => [
      ...reconcileFixVerifications([finding], result.findings, {
        ...result.verificationCoverage,
        deploymentConfirmed: deployed.has(finding.id),
        mergeSettled: settled(finding.id),
      }),
    ]),
  )

  const verified = [...verdicts].filter(([, v]) => v === 'verified').map(([id]) => id)
  const inconclusive = [...verdicts].filter(([, v]) => v === 'inconclusive').map(([id]) => id)
  const rejected = [...verdicts].filter(([, v]) => v === 'rejected').map(([id]) => id)

  // The record of each decided fix: what was measured before, what after, and in words. Written
  // per finding, in the same transaction as the status, so an outcome never exists without its
  // evidence. A verdict reached without a deployment report says so, because the basis of a
  // claim is part of the claim.
  const byId = new Map(merged.map((finding) => [finding.id, finding]))
  const recordOf = (id: string, outcome: 'verified' | 'rejected') => {
    const record = verificationFor(byId.get(id)!, outcome, result.findings, now)
    if (deployed.has(id)) return record
    return {
      ...record,
      summary:
        outcome === 'verified'
          ? `${record.summary} Confirmed on the live site itself. This host sent no deployment report, and the page showing the change is the evidence that it was deployed.`
          : `${record.summary} It was still there more than ${MERGE_SETTLED_HOURS} hours after the merge. This host sent no deployment report, so if the change was never deployed, deploy it and run an audit.`,
    }
  }

  /** What is said on a fix that is still waiting, and why. Always dated. */
  const waitingNote = (id: string): string => {
    if (deployed.has(id)) {
      return 'Deployment confirmed, but the required pages or root files could not be checked completely. The worker will check again; no success is inferred from missing evidence.'
    }
    const checks = result.verificationCoverage.checks
    const observed = checks
      ? checks[id]
      : reconcileFixVerifications([byId.get(id)!], result.findings, {
          ...result.verificationCoverage,
          deploymentConfirmed: true,
        }).get(id)
    const seen =
      observed === 'rejected'
        ? `${LIVE_CHECK_NOTE} on ${stamp(now)}: the problem is still there. That usually means the merge has not been deployed yet. It is checked again over the next two days, and is recorded as not working only if it is still there ${MERGE_SETTLED_HOURS} hours after the merge.`
        : `${LIVE_CHECK_NOTE} on ${stamp(now)}: the pages or files this fix changes could not be read completely, so nothing was concluded. It is checked again.`
    return evidenceNote ? `${seen} (No deployment report: ${evidenceNote})` : seen
  }

  await withTenant(db, job.tenantId, async (tx) => {
    // Serialize against connection replacement/disconnect and repository changes.
    const [currentSite] = await tx.select().from(sites).where(eq(sites.id, site.id)).for('update')
    const [currentHosting] = await tx
      .select({ revision: hostingConnections.revision })
      .from(hostingConnections)
      .where(eq(hostingConnections.siteId, site.id))
    if (
      !currentSite ||
      currentSite.url !== site.url ||
      currentSite.repoFullName !== site.repoFullName ||
      currentSite.githubInstallationId !== site.installationId ||
      (currentHosting?.revision ?? null) !== hostingRevision
    )
      throw new Error('Site or hosting connection changed during verification; retry required.')
    for (const id of verified) {
      await tx
        .update(findings)
        .set({ status: 'verified', fixError: null, verification: recordOf(id, 'verified') })
        .where(eq(findings.id, id))
    }
    for (const id of inconclusive) {
      await tx
        .update(findings)
        .set({ fixError: waitingNote(id) })
        .where(and(eq(findings.id, id), eq(findings.status, 'merged')))
    }
    for (const id of rejected) {
      await tx
        .update(findings)
        .set({ status: 'rejected', fixError: null, verification: recordOf(id, 'rejected') })
        .where(eq(findings.id, id))
    }
  })

  // A confirmed deployment that could not be checked is worth the queue's own quick retry. A fix
  // waiting on a deployment nobody has reported is not: it has its schedule, and failing the job
  // would only fill the run's summary with failures that are not failures.
  if (inconclusive.some((id) => deployed.has(id)))
    throw new Error('Verification inconclusive; retry after the pages can be read.')
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
