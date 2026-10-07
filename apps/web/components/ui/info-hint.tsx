import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A small "i" beside a term, with a sentence or two behind it.
 *
 * For the places where a short label cannot carry what somebody new needs: what share of voice
 * is, why a citation takes three days, what the monthly cap counts. The page stays short for the
 * person who knows, and the explanation is one tap away for the person who does not.
 *
 * Built on `<details>`, so it opens with a click, a tap, Enter or Space, works with JavaScript
 * off, and needs no library. A hover-only tooltip would reach a mouse and nothing else: no touch
 * screen and no keyboard. The label names what is being explained, so a screen reader hears
 * "About share of voice" and not "button".
 */
export function InfoHint({
  label,
  children,
  align = 'start',
}: {
  /** What this explains, to finish the phrase "About ...". */
  label: string
  children: ReactNode
  /** Which edge of the icon the panel lines up with. Use `end` near the right of the page. */
  align?: 'start' | 'end'
}) {
  return (
    <details className="hint">
      <summary aria-label={`About ${label}`}>
        <Info size={14} aria-hidden="true" />
      </summary>
      <div className={`hint-body ${align === 'end' ? 'hint-end' : ''}`.trim()}>{children}</div>
    </details>
  )
}
