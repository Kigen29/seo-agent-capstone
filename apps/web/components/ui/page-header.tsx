import type { ReactNode } from 'react'

/**
 * The kicker, the title, and whatever acts on the page.
 *
 * This exact triplet, a `card-kicker` div followed by an `<h1>` with an inline font-weight
 * override, was copy-pasted at four call sites, each with slightly different margins. That is the
 * clearest possible signal for a component: the same idea, expressed four times, drifting.
 *
 * `actions` sits on the same row on a wide screen and wraps under the title on a narrow one,
 * which is the behaviour every one of those four hand-rolled headers wanted and none of them
 * had, because inline styles cannot express a breakpoint.
 */
export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      {/*
        `flex-1` on the text, `shrink-0` on the actions. Without it the text block sizes to its own
        content, and a description capped at 68ch is wide enough that the actions had nowhere to go
        but a second line, where they sat right-aligned under the paragraph looking like they
        belonged to nothing. With it the text takes whatever is left and the two share a row until
        the screen is genuinely too narrow, which is when wrapping is the right answer.
      */}
      <div className="min-w-0 flex-1">
        {kicker && <div className="card-kicker">{kicker}</div>}
        <h1 className="m-0">{title}</h1>
        {description && <p className="text-muted mt-2 mb-0 max-w-[68ch] text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
