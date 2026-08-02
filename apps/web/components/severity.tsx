import type { Severity } from '@seo/core'

/**
 * Severity, in one place.
 *
 * This was previously three places: a `Record<Severity, CSSProperties>` here, a near-identical
 * one inlined in the findings inbox, and `.tag-accent` in the stylesheet. Three copies of one
 * decision is three chances to drift, and a redesign that recolours severity would have had to
 * find all three. The tints now live in `classical.css` as `.tag-critical` through `.tag-info`,
 * and this file maps a severity to its class and its label and nothing else.
 *
 * Critical and high carry real status colour rather than the gold accent, so a page of findings
 * can be scanned rather than read. Medium, low and info stay neutral, which preserves the
 * original instinct: only the top two bands are allowed to shout.
 */

const LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/** The tag class for a severity. Exported so a table cell can style itself without importing JSX. */
export const severityClass = (severity: Severity): string => `tag tag-${severity}`

export const severityLabel = (severity: Severity): string => LABEL[severity]

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={severityClass(severity)}>{LABEL[severity]}</span>
}
