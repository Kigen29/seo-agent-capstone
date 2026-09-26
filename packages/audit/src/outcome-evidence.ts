import type { Finding, MetricSnapshot, VerificationResult } from '@seo/core'
import type { MergedFindingRef } from './verify-fixes.js'

/**
 * The evidence behind "did the fix work?", recorded at the two moments that can answer it.
 *
 * Until now a merged fix ended as a status flip, verified or rejected, with nothing kept about what
 * was measured or when. The finding row already had `baseline` and `verification` columns for this;
 * nothing wrote them. These build their contents from what the product already knows:
 *
 *   - the baseline, when the pull request opens: how many of the pages the rule flagged fail it;
 *   - the verification, after the fix is deployed and the site re-audited: how many still do.
 *
 * The measurement is the rule's own observation, a count of failing pages, because that is what
 * the finding claimed and what its falsification condition is about. It says nothing about traffic,
 * which moves weeks later and for many reasons; that is a separate, slower report.
 */

/** The metric name both snapshots use, so before and after are the same measurement. */
export function failingPagesMetric(ruleId: string): string {
  return `${ruleId} failing pages`
}

/** Snapshot taken when the fix's pull request opens: every flagged page fails the rule. */
export function baselineFor(
  finding: { ruleId: string; affectedUrls: readonly string[] },
  now: Date = new Date(),
): MetricSnapshot {
  const at = now.toISOString()
  return {
    capturedAt: at,
    metrics: [
      {
        kind: 'metric',
        source: 'crawler',
        observedAt: at,
        metric: failingPagesMetric(finding.ruleId),
        value: finding.affectedUrls.length,
        unit: 'count',
      },
    ],
  }
}

/** How many of the pages the merged finding flagged still fail the same rule in a fresh audit. */
export function stillFailingCount(merged: MergedFindingRef, current: readonly Finding[]): number {
  const failing = new Set(
    current
      .filter((finding) => finding.ruleId === merged.ruleId)
      .flatMap((finding) => finding.affectedUrls),
  )
  return merged.affectedUrls.filter((url) => failing.has(url)).length
}

/**
 * The verification record for a decided fix. Only verified or rejected: an inconclusive check is a
 * retry, not an outcome, and recording it would look like a verdict.
 */
export function verificationFor(
  merged: MergedFindingRef & { baseline?: MetricSnapshot | null },
  outcome: 'verified' | 'rejected',
  current: readonly Finding[],
  now: Date = new Date(),
): VerificationResult {
  const before = merged.baseline ?? baselineFor(merged, now)
  const total = merged.affectedUrls.length
  const remaining = outcome === 'verified' ? 0 : stillFailingCount(merged, current)
  const at = now.toISOString()
  const pages = (n: number) => `${n} page${n === 1 ? '' : 's'}`

  return {
    outcome,
    verifiedAt: at,
    before,
    after: {
      capturedAt: at,
      metrics: [
        {
          kind: 'metric',
          source: 'crawler',
          observedAt: at,
          metric: failingPagesMetric(merged.ruleId),
          value: remaining,
          unit: 'count',
        },
      ],
    },
    summary:
      outcome === 'verified'
        ? `After the fix was deployed, ${merged.ruleId} no longer fires on any of the ${pages(total)} it flagged.`
        : `After the fix was deployed, ${merged.ruleId} still fires on ${remaining} of the ${pages(total)} it flagged, so the fix did not work.`,
  }
}
