/**
 * The Core Web Vitals thresholds, from Google's own definitions.
 *
 * These are facts, not preferences, and they have not moved since INP replaced FID on
 * 12 March 2024. If a generated recommendation ever contradicts one of these it is a bug,
 * not a judgement call. They live in one named place so there is exactly one thing to check
 * against the primary source, and so no rule can quietly invent its own idea of "slow".
 *
 * Every threshold is evaluated at the 75th percentile of real Chrome users over a rolling
 * 28-day window. That last part is not a footnote: it is why a fix does not show here for up
 * to 28 days, and it is the single most common thing an SEO tool gets wrong by quoting a lab
 * number instead.
 */

export type Band = 'good' | 'needs_improvement' | 'poor'

export interface Threshold {
  /** At or below this p75 value, the metric is good. */
  goodAtOrBelow: number
  /** Above this p75 value, the metric is poor. Between the two, it needs improvement. */
  poorAbove: number
  unit: 'ms' | 'score'
  label: string
}

export const THRESHOLDS = {
  /** Largest Contentful Paint. Loading. The one with the biggest commercial impact. */
  lcp: { goodAtOrBelow: 2500, poorAbove: 4000, unit: 'ms', label: 'Largest Contentful Paint' },
  /** Interaction to Next Paint. Responsiveness. The hardest of the three to fix. */
  inp: { goodAtOrBelow: 200, poorAbove: 500, unit: 'ms', label: 'Interaction to Next Paint' },
  /** Cumulative Layout Shift. Visual stability. Unitless, and usually the cheapest to fix. */
  cls: { goodAtOrBelow: 0.1, poorAbove: 0.25, unit: 'score', label: 'Cumulative Layout Shift' },
} as const satisfies Record<string, Threshold>

export type MetricId = keyof typeof THRESHOLDS

/**
 * Which band a p75 value falls in.
 *
 * The boundaries are inclusive at the good end (<= 2500 is good, exactly) and exclusive at
 * the poor end (> 4000 is poor), matching Google's definitions precisely. Getting the
 * boundary wrong by one would silently reclassify a site that sits exactly on 2.5s.
 */
export function bandFor(metric: MetricId, p75: number): Band {
  const threshold = THRESHOLDS[metric]
  if (p75 <= threshold.goodAtOrBelow) return 'good'
  if (p75 > threshold.poorAbove) return 'poor'
  return 'needs_improvement'
}
