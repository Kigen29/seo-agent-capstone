import type { ReactNode } from 'react'

/**
 * A labelled figure. Promoted out of the finding detail page, where it was defined locally and
 * never exported, which is the usual fate of the one component that most wanted to be shared.
 *
 * `tnum` matters more than it looks: without tabular figures a row of numbers jitters sideways
 * as values change, which is exactly what the audit page does while a crawl is running.
 */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card gap-1 p-3">
      <div className="card-kicker">{label}</div>
      <div className="tnum text-[15px]">{value}</div>
    </div>
  )
}

/** A responsive row of them. Two up on a phone, four across from md. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
}
