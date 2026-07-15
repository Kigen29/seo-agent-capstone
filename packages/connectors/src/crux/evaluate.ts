import { parseFinding, type Finding } from '@seo/core'
import { THRESHOLDS, type Band, type MetricId } from './thresholds.js'
import type { CruxRecord } from './types.js'

/**
 * Turn a CrUX record into performance findings, deterministically.
 *
 * This is the judge, kept apart from the client that does the fetching, so the opinion can be
 * tested without a network and the fetch can be tested without an opinion. It is a pure
 * function: the same field data always yields the same findings.
 *
 * It encodes three things from CLAUDE.md that are not preferences but rules of the domain,
 * and getting any of them wrong is a bug rather than a tuning choice:
 *
 *   1. Never flag a metric that is already good. "Never optimise a green metric." A finding
 *      for an LCP of 1.8s would send a developer to spend a week making a fast thing slightly
 *      faster while the actually-poor metric sits untouched.
 *
 *   2. Poor outranks needs-improvement, and the impact scores reflect the commercial order:
 *      LCP has the biggest commercial impact, INP is the hardest to fix, CLS the cheapest.
 *      The priority score does the sorting; these numbers feed it honestly.
 *
 *   3. Every finding says, in its falsification, that CrUX will not move for up to 28 days,
 *      and that a green Lighthouse score is not this metric. Those are the two ways a user is
 *      most often misled about Core Web Vitals, and the finding pre-empts both.
 */

interface Profile {
  ruleId: string
  /** 0..100. Poor above needs-improvement; LCP highest, per commercial impact. */
  impact: Record<'poor' | 'needs_improvement', number>
  /** INP is the hardest of the three; CLS usually the cheapest. */
  effort: Finding['estimatedEffort']
}

const PROFILE: Record<MetricId, Profile> = {
  lcp: { ruleId: 'PERF-001', impact: { poor: 70, needs_improvement: 45 }, effort: 'medium' },
  inp: { ruleId: 'PERF-002', impact: { poor: 65, needs_improvement: 40 }, effort: 'large' },
  cls: { ruleId: 'PERF-003', impact: { poor: 55, needs_improvement: 30 }, effort: 'small' },
}

/** How many Core Web Vitals we evaluate. The scorecard reports this as the check count. */
export const CORE_WEB_VITALS_CHECKS = Object.keys(PROFILE).length

const format = (metric: MetricId, p75: number): string =>
  THRESHOLDS[metric].unit === 'ms' ? `${(p75 / 1000).toFixed(2)}s` : p75.toFixed(3)

export function evaluateCoreWebVitals(siteId: string, record: CruxRecord): Finding[] {
  const findings: Finding[] = []

  for (const metric of record.metrics) {
    // Rule 1, and it is the first line for a reason: a good metric is not a finding.
    if (metric.band === 'good') continue

    const band = metric.band as Exclude<Band, 'good'>
    const profile = PROFILE[metric.metric]
    const threshold = THRESHOLDS[metric.metric]
    const value = format(metric.metric, metric.p75)

    const goodValue =
      threshold.unit === 'ms'
        ? `${(threshold.goodAtOrBelow / 1000).toFixed(1)}s`
        : threshold.goodAtOrBelow.toFixed(2)

    findings.push(
      parseFinding({
        id: `${profile.ruleId}#0`,
        siteId,
        ruleId: profile.ruleId,
        axis: 'performance',
        severity: band === 'poor' ? 'high' : 'medium',
        // Field data is real users, so the measurement is certain. What to do about it is not,
        // but that a real problem exists is not in doubt.
        confidence: 1,
        title:
          `${threshold.label} is ${band === 'poor' ? 'poor' : 'below good'}: ` +
          `${value} at the 75th percentile of real users (good is ${goodValue} or better)`,
        evidence: {
          kind: 'metric',
          observedAt: new Date().toISOString(),
          source: 'crux',
          metric: threshold.label,
          value: metric.p75,
          unit: threshold.unit === 'ms' ? 'ms' : 'score',
          percentile: 75,
          url: record.key,
        },
        affectedUrls: [record.key],
        estimatedEffort: profile.effort,
        estimatedImpact: profile.impact[band],
        falsification:
          `Re-query CrUX for this origin after the fix ships. The p75 will not move for up ` +
          `to 28 days, because CrUX is a rolling 28-day window of real users, so an immediate ` +
          `re-check proving nothing is expected, not a failure. Do not use a Lighthouse or ` +
          `PageSpeed lab score to verify: Lighthouse is lab data and cannot measure this ` +
          `metric${metric.metric === 'inp' ? ' at all (it substitutes Total Blocking Time)' : ''}, ` +
          `so a green lab score alongside this red field score is normal. This finding was ` +
          `wrong only if a fresh CrUX query still shows a p75 in the same band 28 days on.`,
        // Detectable now, but not yet auto-fixable: the cause lives in this specific site's
        // resources and needs investigation, not a templated diff.
        fixable: false,
        status: 'open',
      }),
    )
  }

  return findings
}
