import { randomUUID } from 'node:crypto'
import { getFinding } from '@seo/audit'
import { appendJob, findings, sites, withTenant } from '@seo/db'
import { and, eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { RouteDeps } from './options.js'

/**
 * Ask for a pull request for one finding, with every precondition checked.
 *
 * Shared by the button on a finding and the action that asks for several at once, so the two
 * cannot drift: whatever makes one finding ineligible makes it ineligible in a batch, with the
 * same words. A refusal is a value and not an exception, because in a batch the next finding
 * still has to be tried.
 */
export type FixRequestResult =
  { queued: true } | { queued: false; status: 404 | 409 | 503; message: string }

export async function requestFix(
  deps: RouteDeps,
  tenantId: string,
  findingId: string,
  log: FastifyBaseLogger,
): Promise<FixRequestResult> {
  const { db, options } = deps
  if (!options.enqueueFix) {
    return { queued: false, status: 503, message: 'The fixer is not configured.' }
  }

  const finding = await getFinding(db, tenantId, findingId)
  if (!finding) return { queued: false, status: 404, message: 'Not found.' }

  if (!finding.fixable) {
    return {
      queued: false,
      status: 409,
      message: 'This finding cannot be fixed in code automatically; it needs a human.',
    }
  }
  if (finding.status !== 'open') {
    return {
      queued: false,
      status: 409,
      message: 'A pull request for this finding has already been opened.',
    }
  }
  // The same issue, raised again by a newer audit while a fix from an earlier one is still in
  // flight. A second pull request for it would conflict with the first (ADR-0029).
  if (finding.earlier?.work === 'in_progress') {
    return {
      queued: false,
      status: 409,
      message:
        'A fix for this issue is already in progress from an earlier audit' +
        (finding.earlier.prUrl ? `: ${finding.earlier.prUrl}` : '.'),
    }
  }

  const [site] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ repo: sites.repoFullName, installation: sites.githubInstallationId })
      .from(sites)
      .where(eq(sites.id, finding.siteId))
      .limit(1),
  )
  if (!site || !site.repo || !site.installation) {
    return { queued: false, status: 409, message: 'Connect a repository to this site first.' }
  }

  const job = {
    requestId: randomUUID(),
    tenantId,
    siteId: finding.siteId,
    findingRowId: finding.rowId,
  }
  const accepted = await withTenant(db, tenantId, async (tx) => {
    const changed = await tx
      .update(findings)
      .set({ fixError: null })
      .where(and(eq(findings.id, finding.rowId), eq(findings.status, 'open')))
      .returning({ id: findings.id })
    if (changed.length === 0) return false
    // The error reset and the durable request must commit or roll back together.
    await appendJob(tx, tenantId, `fix:${job.requestId}`, 'fix', job)
    return true
  })
  if (!accepted) return { queued: false, status: 409, message: 'This finding is no longer open.' }

  try {
    await options.enqueueFix(job)
  } catch {
    log.warn('Fix queued in outbox; immediate queue publication unavailable.')
  }
  return { queued: true }
}
