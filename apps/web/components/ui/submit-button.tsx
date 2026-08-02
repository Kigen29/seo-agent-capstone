'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * A submit button that knows its own form is in flight.
 *
 * Every form in the app hand-rolled this, and each one did it slightly differently: some swapped
 * the label, some also disabled the button, and the single most consequential control in the
 * product (open a pull request) did neither, so it looked inert while a server action talked to
 * GitHub. A user with no acknowledgement clicks again.
 *
 * `useFormStatus` only reports the status of the form it is rendered *inside*, which is why this
 * has to be its own component rather than a hook call in the page.
 *
 * `aria-busy` matters alongside `disabled`: disabling alone removes the button from the tab order
 * mid-interaction, which moves a keyboard user's focus somewhere they did not ask to be, so the
 * pending label has to be announced rather than merely shown.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn btn-primary',
  disabled = false,
}: {
  children: ReactNode
  /** Shown while the action runs. Say what is happening, not "Loading". */
  pendingLabel: string
  className?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  )
}
