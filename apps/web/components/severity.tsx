import type { Severity } from '@seo/core'

const STYLE: Record<Severity, string> = {
  critical: 'border-red-900 bg-red-950 text-red-300',
  high: 'border-orange-900 bg-orange-950 text-orange-300',
  medium: 'border-amber-900 bg-amber-950 text-amber-300',
  low: 'border-sky-900 bg-sky-950 text-sky-300',
  info: 'border-neutral-800 bg-neutral-900 text-neutral-400',
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-xs uppercase ${STYLE[severity]}`}>
      {severity}
    </span>
  )
}
