import type { Finding } from '@seo/core'

/**
 * Deciding whether a merged fix actually worked, by re-audit.
 *
 * A deterministic finding is verified the same way it was found: run the rules again over a fresh
 * crawl and see whether the finding comes back. If the same rule fires on the same page, the fix
 * did not work and the finding stands; if it is gone, the fix held. This is the falsification
 * condition made executable, and it stays honest for the same reason detection does: a parser
 * re-checks, not a language model.
 *
 * The comparison is pure so it can be tested against fixtures with no crawl. The worker does the
 * crawl and the writes; this only decides the verdict.
 */

/** The slice of a finding awaiting verification that the comparison needs. */
export interface MergedFindingRef {
  /** The finding row id, so the worker knows which row to update. */
  id: string
  ruleId: string
  affectedUrls: string[]
}

/** A verified fix is gone; a rejected one is still present. Incomplete evidence is inconclusive. */
export type FixVerdict = 'verified' | 'rejected' | 'inconclusive'

export interface VerificationCoverage {
  /**
   * Rule-specific checks, keyed by persisted finding ID. A finding with no entry has no
   * purpose-built check, and is decided by whether its own rule still fires (ADR-0049).
   */
  checks?: Record<string, FixVerdict>
  successfulUrls: readonly string[]
  evaluatedRuleIds: readonly string[]
  /** Established by deployment evidence, never inferred from a merge alone. */
  deploymentConfirmed: boolean
  /**
   * There is no deployment report, and the merge is old enough that any deployment has happened.
   * This is what allows a problem still on the live site to be called a failure without one
   * (ADR-0047). It is never needed to call a fix a success.
   */
  mergeSettled?: boolean
}

/**
 * How long after a merge a problem still on the live site is called a failure, when no host has
 * reported a deployment. Long enough for a slow pipeline and a CDN to catch up; short enough that
 * "merged, checking" is not where a fix goes to be forgotten.
 */
export const MERGE_SETTLED_HOURS = 48

/**
 * When, after a merge, the live site is looked at while there is no deployment report.
 *
 * Each look is a crawl and a row in the audit history, so it is not every hour. Most deployments
 * finish in minutes, so the early looks are close together, and after a day it is once a day
 * until something can be concluded.
 */
const LIVE_CHECK_HOURS = [1, 3, 6, 12, 24]
const HOUR = 3_600_000

/**
 * Whether the live site should be looked at on this wake, for a fix with no deployment report.
 *
 * True when a checkpoint has passed since the previous look. With no previous look it is always
 * true. With no record of when the merge happened, it is once a day.
 */
export function liveCheckDue(
  mergedAt: Date | null,
  previousCheckAt: Date | null,
  now: Date,
): boolean {
  if (!previousCheckAt) return true
  if (!mergedAt) return now.getTime() - previousCheckAt.getTime() >= 24 * HOUR

  const since = (moment: Date) => (moment.getTime() - mergedAt.getTime()) / HOUR
  const before = since(previousCheckAt)
  const after = since(now)
  if (LIVE_CHECK_HOURS.some((hours) => before < hours && hours <= after)) return true
  // After the first day, each whole day since the merge is a checkpoint.
  return after >= 24 && Math.floor(after / 24) > Math.floor(Math.max(before, 0) / 24)
}

/** Whether a merge is old enough that a problem still on the live site counts against the fix. */
export function mergeSettled(mergedAt: Date | null, now: Date): boolean {
  return mergedAt !== null && now.getTime() - mergedAt.getTime() >= MERGE_SETTLED_HOURS * HOUR
}

/**
 * Whether a fresh audit still reproduces a merged finding.
 *
 * A match is the same rule firing on at least one of the same URLs. Keying on the rule alone would
 * be too loose (a different page failing the same rule is a different problem, not this one not
 * being fixed); keying on the exact finding key would be too tight (the key is positional and
 * shifts when other pages change between crawls). Rule plus an overlapping affected URL is the
 * stable identity of "this finding, on this page".
 */
export function stillPresent(merged: MergedFindingRef, current: readonly Finding[]): boolean {
  return current.some(
    (finding) =>
      finding.ruleId === merged.ruleId &&
      finding.affectedUrls.some((url) => merged.affectedUrls.includes(url)),
  )
}

/**
 * Verdict for every merged finding against a fresh audit's findings.
 *
 * Two questions, kept apart. What did the live site show: the fix in place, the problem still
 * there, or not enough to say. And is that enough to decide.
 *
 * With a deployment report, what the site showed is the verdict. Without one (ADR-0047):
 *
 *   - **The fix is on the live site.** Verified. The page itself is the evidence that the change
 *     was deployed; a report from the host would add nothing to it.
 *   - **The problem is still there.** Not a failure yet, because the commonest reason is that the
 *     deployment has not happened. It becomes one only when the merge has settled.
 *   - **Could not tell.** Inconclusive, as it always was. Nothing is inferred from a page that
 *     could not be read.
 */
export function reconcileFixVerifications(
  merged: readonly MergedFindingRef[],
  current: readonly Finding[],
  coverage?: VerificationCoverage,
): Map<string, FixVerdict> {
  const verdicts = new Map<string, FixVerdict>()
  for (const finding of merged) {
    if (!coverage) {
      verdicts.set(finding.id, 'inconclusive')
      continue
    }

    const covered =
      coverage.evaluatedRuleIds.includes(finding.ruleId) &&
      finding.affectedUrls.length > 0 &&
      finding.affectedUrls.every((url) => coverage.successfulUrls.includes(url))
    const specific = coverage.checks?.[finding.id]
    const observed: FixVerdict = specific
      ? specific
      : covered
        ? stillPresent(finding, current)
          ? 'rejected'
          : 'verified'
        : 'inconclusive'

    verdicts.set(
      finding.id,
      coverage.deploymentConfirmed || observed === 'verified'
        ? observed
        : observed === 'rejected' && coverage.mergeSettled
          ? 'rejected'
          : 'inconclusive',
    )
  }
  return verdicts
}
