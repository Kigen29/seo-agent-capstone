import type { ReactNode } from 'react'

/**
 * What happened after an action that sent the browser somewhere and back.
 *
 * Starting an audit, connecting Google or a repository, asking for a pull request and paying for
 * a plan all leave the page and return with a short status in the address. Each page used to
 * turn that status into its own sentence, in its own shape: some a bare line, some two sentences
 * run together, one of them never shown at all. This is the one shape for all of them, and it is
 * the shape `<ErrorNote>` already uses for a failure reported in place: a title that says what
 * happened, and a line that says what it means or what to do.
 *
 * So a person learns one thing to look for. Where on the page it appears is the page's choice;
 * what it looks like is not.
 */
export interface Outcome {
  /** `ok` it worked, `info` nothing changed, `warn` yours to fix, `error` ours. */
  tone: 'ok' | 'info' | 'warn' | 'error'
  /** What happened, in a few words. */
  title: string
  /** What it means, or what to do next. */
  detail?: ReactNode
}

export function OutcomeNote({
  outcome,
  className = '',
}: {
  outcome: Outcome | null | undefined
  className?: string
}) {
  if (!outcome) return null

  // Something to act on interrupts a screen reader; good news and "nothing changed" wait.
  const urgent = outcome.tone === 'warn' || outcome.tone === 'error'

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={`note note-${outcome.tone} ${className}`.trim()}
    >
      <div className="font-semibold">{outcome.title}</div>
      {outcome.detail && <div className="mt-0.5">{outcome.detail}</div>}
    </div>
  )
}

/** Look a status up in a page's own table. An unknown status shows nothing, never a guess. */
export function outcomeFor(
  table: Record<string, Outcome>,
  status: string | undefined,
): Outcome | undefined {
  return status && Object.hasOwn(table, status) ? table[status] : undefined
}
