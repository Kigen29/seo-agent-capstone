import type { ReactNode } from 'react'

/**
 * A short key to the terms a table uses, in the open under or over it.
 *
 * Not a tooltip on each term. A `title` on a non-interactive element reaches a mouse and nothing
 * else: no keyboard, no screen reader, no touch screen. A few definitions on the page serve
 * everyone and cost a line or two.
 *
 * For a term that needs a whole paragraph, use `<InfoHint>` beside it instead. This is for a
 * handful of labels that each take one sentence.
 */
export function Legend({
  items,
  columns = 1,
  className = '',
}: {
  items: { term: ReactNode; meaning: ReactNode }[]
  /** Two columns from a small screen up, for four or more short definitions. */
  columns?: 1 | 2
  className?: string
}) {
  return (
    <dl
      className={`text-muted m-0 grid max-w-[80ch] gap-1 text-[13px] ${columns === 2 ? 'sm:grid-cols-2' : ''} ${className}`.trim()}
    >
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 gap-2">
          <dt className="shrink-0 font-semibold">{item.term}:</dt>
          <dd className="m-0 min-w-0">{item.meaning}</dd>
        </div>
      ))}
    </dl>
  )
}
