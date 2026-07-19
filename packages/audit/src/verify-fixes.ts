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

/** A verified fix is gone; a rejected one is still present. Never invents a third state here. */
export type FixVerdict = 'verified' | 'rejected'

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
 * Verdict for every merged finding against a fresh audit's findings. Verified when the finding no
 * longer reproduces, rejected when it does.
 */
export function reconcileFixVerifications(
  merged: readonly MergedFindingRef[],
  current: readonly Finding[],
): Map<string, FixVerdict> {
  const verdicts = new Map<string, FixVerdict>()
  for (const finding of merged) {
    verdicts.set(finding.id, stillPresent(finding, current) ? 'rejected' : 'verified')
  }
  return verdicts
}
