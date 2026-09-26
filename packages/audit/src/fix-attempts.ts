import { findings, fixAttempts, withTenant, type Database } from '@seo/db'
import { desc, eq } from 'drizzle-orm'

/**
 * Every attempt the agent made to fix one finding, newest first.
 *
 * The finding row keeps only its latest failure. This is the whole history, so a person can see
 * that the agent tried three times, why the first two failed, and which attempt opened the PR.
 */

export interface FixAttempt {
  startedAt: string
  finishedAt: string
  outcome: 'pr_opened' | 'pr_adopted' | 'failed'
  prUrl: string | null
  error: string | null
}

/** How many attempts to return. A finding retried more than this has a bigger problem to show. */
const ATTEMPT_LIMIT = 20

/** Null when the finding is not the tenant's, so the route can answer 404. */
export async function listFixAttempts(
  db: Database,
  tenantId: string,
  findingRowId: string,
): Promise<FixAttempt[] | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [finding] = await tx
      .select({ id: findings.id })
      .from(findings)
      .where(eq(findings.id, findingRowId))
      .limit(1)
    if (!finding) return null

    const rows = await tx
      .select({
        startedAt: fixAttempts.startedAt,
        finishedAt: fixAttempts.finishedAt,
        outcome: fixAttempts.outcome,
        prUrl: fixAttempts.prUrl,
        error: fixAttempts.error,
      })
      .from(fixAttempts)
      .where(eq(fixAttempts.findingId, findingRowId))
      .orderBy(desc(fixAttempts.finishedAt))
      .limit(ATTEMPT_LIMIT)

    return rows.map((row) => ({
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt.toISOString(),
      outcome: row.outcome,
      prUrl: row.prUrl ?? null,
      error: row.error ?? null,
    }))
  })
}
