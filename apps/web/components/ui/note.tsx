import type { ReactNode } from 'react'

/**
 * A status banner: the outcome of something the user just did, or the state of something they are
 * waiting on.
 *
 * The tones are `.note-*` classes rather than props carrying colours, so there is exactly one
 * place that decides what "warning" looks like. Before the token work these four were nearly
 * indistinguishable (`ok` and `warn` shared a background, `error` was grey), which meant the app
 * could report a verified fix and a rejected one in almost the same colour.
 *
 * `role` defaults to `status`, which announces politely to a screen reader without interrupting.
 * An error that the user must act on should pass `role="alert"`, which interrupts; the difference
 * is whether the message is news or an obstacle.
 */
export type NoteTone = 'ok' | 'warn' | 'error' | 'info'

export function Note({
  tone = 'info',
  role = 'status',
  className = '',
  children,
}: {
  tone?: NoteTone
  role?: 'status' | 'alert'
  className?: string
  children: ReactNode
}) {
  return (
    <p role={role} className={`note note-${tone} ${className}`.trim()}>
      {children}
    </p>
  )
}
