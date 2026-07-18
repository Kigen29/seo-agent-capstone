import type { CSSProperties } from 'react'
import type { Severity } from '@seo/core'

/**
 * Severity as a Classical tag. The two loud bands (critical, high) carry the gold accent; the
 * quieter ones sit in neutral so a page of findings does not read as a wall of alarm.
 */
const STYLE: Record<Severity, CSSProperties> = {
  critical: { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)' },
  high: { background: 'var(--color-accent-100)', color: 'var(--color-accent-700)' },
  medium: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-800)' },
  low: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-700)' },
  info: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-600)' },
}

const LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="tag" style={STYLE[severity]}>
      {LABEL[severity]}
    </span>
  )
}
