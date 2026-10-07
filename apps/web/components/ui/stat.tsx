import type { ReactNode } from 'react'

/**
 * A labelled figure. Promoted out of the finding detail page, where it was defined locally and
 * never exported, which is the usual fate of the one component that most wanted to be shared.
 *
 * `tnum` matters more than it looks: without tabular figures a row of numbers jitters sideways
 * as values change, which is exactly what the audit page does while a crawl is running.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  /** One line of context under the figure: what it is out of, or since when. */
  hint?: ReactNode
  /** `accent` for the one figure in a row that is in motion; `success` for money still free. */
  tone?: 'accent' | 'success' | undefined
}) {
  return (
    <div className={tone ? `stat stat-${tone}` : 'stat'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

/** A responsive row of them. Two up on a phone, four across from md. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">{children}</div>
}
