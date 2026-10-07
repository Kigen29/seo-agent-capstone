import type { ReactNode } from 'react'
import { InfoHint } from '@/components/ui/info-hint'

/**
 * A labelled control, with an optional "i" beside the label and a line of help under it.
 *
 * The hint sits beside the `<label>` and not inside it. A control nested in a label is activated
 * by a click anywhere on that label, so a hint inside one would open whenever the label text was
 * clicked, and its text would be read out as part of the field's name.
 */
export function Field({
  id,
  label,
  hint,
  help,
  children,
}: {
  /** The id of the control this labels. Pass the same value to the input. */
  id: string
  label: ReactNode
  /** The longer explanation, behind the icon. */
  hint?: { about: string; body: ReactNode }
  /** A short line always shown under the control. */
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="card-kicker">
          {label}
        </label>
        {hint && <InfoHint label={hint.about}>{hint.body}</InfoHint>}
      </div>
      {children}
      {help && <div className="text-muted text-[13px]">{help}</div>}
    </div>
  )
}
