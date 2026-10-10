import { type Database, findings, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'

/** Where a requested fix has got to, and clearing the reason a past attempt failed. */

/**
 * Just enough to answer "is the pull request being written, and did it work".
 *
 * The sibling of `getAuditProgress`, and it exists for the same reason: the finding page polls
 * while a fix job is in flight, and `getFinding` returns the full evidence, baseline and
 * verification JSON to read three scalars.
 *
 * The three states a caller has to tell apart are all readable from the finding row, so no new
 * column and no new migration: still `open` with no error means nobody has finished the job yet;
 * `pr_open` with a URL means it worked; still `open` with an error means the attempt failed and
 * said why. That third case only reads correctly because the error is cleared when the job is
 * enqueued (`clearFixError`); without that, a retry would show the previous attempt's error
 * immediately and the poll would stop before the new attempt had started.
 */
export interface FixProgress {
  id: string
  status: string
  prUrl: string | null
  fixError: string | null
  /** True once there is nothing left to poll for, so the client can stop. */
  finished: boolean
}

export async function getFixProgress(
  db: Database,
  tenantId: string,
  findingRowId: string,
): Promise<FixProgress | undefined> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: findings.id,
        status: findings.status,
        prUrl: findings.prUrl,
        fixError: findings.fixError,
      })
      .from(findings)
      .where(eq(findings.id, findingRowId))
      .limit(1)

    if (!row) return undefined

    // Anything that is no longer `open` has reached an outcome the page renders on its own: a PR
    // opened, merged, verified, rejected. `open` with an error recorded is the failure case.
    return { ...row, finished: row.status !== 'open' || row.fixError !== null }
  })
}

/**
 * Forget the previous attempt's failure, because a new one is about to start.
 *
 * Called when a fix is enqueued. `fixError` describes the most recent attempt, and the worker
 * already clears it on success; what was missing is clearing it at the *start*, which is what
 * makes "still open, no error" mean "in flight" rather than "in flight, or failed some time ago".
 * Without it the finding page would also contradict itself on a retry, showing the banner saying
 * a pull request is on its way directly above the error from the attempt before.
 */
export async function clearFixError(
  db: Database,
  tenantId: string,
  findingRowId: string,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx.update(findings).set({ fixError: null }).where(eq(findings.id, findingRowId)),
  )
}
