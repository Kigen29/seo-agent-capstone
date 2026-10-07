import type { UserError } from '@/lib/user-error'

/**
 * The one way an error is shown.
 *
 * A title that says what happened and a line that says what to do, in the same place and the same
 * shape on every screen, announced to a screen reader the moment it appears. What tone it takes
 * depends on whose problem it is: something the person can correct is a warning, a feature that
 * is switched off or a service that is starting is information, and only a fault on our side is
 * red.
 */
const TONE: Record<UserError['kind'], 'warn' | 'info' | 'error'> = {
  invalid: 'warn',
  budget: 'warn',
  not_found: 'warn',
  unavailable: 'info',
  waking: 'info',
  failed: 'error',
}

export function ErrorNote({
  error,
  className = '',
}: {
  error: UserError | null | undefined
  className?: string
}) {
  if (!error) return null

  return (
    <div role="alert" className={`note note-${TONE[error.kind]} ${className}`.trim()}>
      <div className="font-semibold">{error.title}</div>
      <div className="mt-0.5">{error.detail}</div>
    </div>
  )
}

/** The matching confirmation, so success is said in the same place failure would be. */
export function SavedNote({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  if (!children) return null

  return (
    <div role="status" className={`note note-ok ${className}`.trim()}>
      {children}
    </div>
  )
}
