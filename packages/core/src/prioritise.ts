import { effortCost } from './effort.js'
import type { Finding } from './finding.js'
import { severityWeight } from './severity.js'

/**
 * priority = severity_weight * confidence * estimatedImpact / effort_cost
 *
 * This is the prioritisation engine, and it is most of the product. Every SEO
 * crawler on the market can produce 400 findings; the useful question is which
 * three to do on Monday. Dividing by effort is what stops the backlog being led
 * by expensive work that happens to sound important.
 *
 * Multiplying by confidence means a shaky detection has to be genuinely
 * high-impact to outrank a certain one.
 *
 * Severity is a weight, not a gate. A cheap high-impact medium can outrank an
 * expensive low-impact critical, and that is intended: making severity a gate would
 * need w_critical > 1300 * w_medium, at which point impact and effort no longer
 * affect the order and the score degenerates into sorting by severity alone. If
 * criticals must never be buried, surface them as their own band in the UI. Do not
 * fix it by inflating the weights, which quietly disables the rest of the formula.
 */
export function priorityScore(
  finding: Pick<Finding, 'severity' | 'confidence' | 'estimatedImpact' | 'estimatedEffort'>,
): number {
  return (
    (severityWeight(finding.severity) * finding.confidence * finding.estimatedImpact) /
    effortCost(finding.estimatedEffort)
  )
}

/**
 * Highest priority first. Pure and stable: equal scores keep their original
 * order, so the same crawl always produces the same backlog.
 */
export function prioritise<T extends Parameters<typeof priorityScore>[0]>(
  findings: readonly T[],
): T[] {
  return [...findings].sort((a, b) => priorityScore(b) - priorityScore(a))
}
