import { findings, fixAttempts, type Database } from '@seo/db'
import { and, eq, isNotNull } from 'drizzle-orm'

/**
 * How often people accept the agent's pull requests, and how often they undo one after merging.
 *
 * The production ground truth for whether a fix was right (STORY-038). An eval set says what the
 * agent should have done; a merge is a person who owns the code agreeing, and a revert is the same
 * person changing their mind. Counted per pull request, not per attempt, because a retried job that
 * reused an open PR is still one PR.
 */
export interface FixPrRates {
  opened: number
  open: number
  merged: number
  closedUnmerged: number
  reverted: number
  /** merged / (merged + closed unmerged). Null until at least one PR is decided. */
  mergeRate: number | null
  /** reverted / merged. Null until at least one PR is merged. */
  revertRate: number | null
}

/** Must run inside the caller's tenant-scoped transaction. */
export async function fixPrRates(tx: Database, siteId: string): Promise<FixPrRates> {
  const rows = await tx
    .select({
      prUrl: fixAttempts.prUrl,
      resolution: fixAttempts.prResolution,
      revertedAt: fixAttempts.revertedAt,
    })
    .from(fixAttempts)
    .innerJoin(findings, eq(findings.id, fixAttempts.findingId))
    .where(and(eq(findings.siteId, siteId), isNotNull(fixAttempts.prUrl)))

  // One entry per PR. A resolved row wins over an unresolved duplicate of the same PR.
  const byPr = new Map<string, { resolution: 'merged' | 'closed' | null; reverted: boolean }>()
  for (const row of rows) {
    const prior = byPr.get(row.prUrl!)
    byPr.set(row.prUrl!, {
      resolution: row.resolution ?? prior?.resolution ?? null,
      reverted: Boolean(row.revertedAt) || Boolean(prior?.reverted),
    })
  }

  const all = [...byPr.values()]
  const merged = all.filter((pr) => pr.resolution === 'merged').length
  const closedUnmerged = all.filter((pr) => pr.resolution === 'closed').length
  const reverted = all.filter((pr) => pr.resolution === 'merged' && pr.reverted).length
  const decided = merged + closedUnmerged

  return {
    opened: all.length,
    open: all.length - decided,
    merged,
    closedUnmerged,
    reverted,
    mergeRate: decided > 0 ? merged / decided : null,
    revertRate: merged > 0 ? reverted / merged : null,
  }
}
