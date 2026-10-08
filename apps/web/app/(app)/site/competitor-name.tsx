'use client'

import { useId, useState, useTransition } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { saveCompetitorName } from './actions'

/**
 * What a competitor is called, shown under its address, with a way to say so yourself.
 *
 * AI answers name businesses and rarely give a web address, so a competitor with no name on
 * record is found far less often than one with (ADR-0041). The name is read from the
 * competitor's own homepage title when the title plainly states it. Many titles do not, and
 * this is where the owner fills the gap.
 *
 * Three states, said differently because they mean different things: a name; a homepage that
 * was read and states none; and a competitor that has not been read yet.
 */
export function CompetitorName({
  siteId,
  domain,
  name,
  onSaved,
}: {
  siteId: string
  domain: string
  /** A name, null when the homepage states none, undefined when it has not been read yet. */
  name: string | null | undefined
  onSaved: (names: Record<string, string | null>) => void
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name ?? '')
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()

  function save(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const result = await saveCompetitorName(siteId, domain, value.trim() || null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.data)
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <div className="text-muted flex flex-wrap items-center gap-x-2 text-[13px]">
        <span>
          {name
            ? `Known as ${name}`
            : name === null
              ? 'Its homepage does not state a name, so it is only found by its address.'
              : 'Name not read yet. It is read from its homepage on the next daily check.'}
        </span>
        <button
          type="button"
          className="underline"
          style={{ color: 'var(--color-accent-700)' }}
          onClick={() => {
            setValue(name ?? '')
            setEditing(true)
          }}
        >
          {name ? 'Change' : 'Add its name'}
          <span className="sr-only"> for {domain}</span>
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={save} className="mt-1 flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={id} className="sr-only">
          What {domain} is called
        </label>
        <input
          id={id}
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="The name as people write it"
          maxLength={120}
          autoFocus
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={pending}>
          {pending ? 'Saving...' : 'Save name'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
      <div className="text-muted text-[13px]">
        Write it the way an article would. It is looked for exactly as written. Leave it empty to
        have it read from their homepage again.
      </div>
      <ErrorNote error={error} />
    </form>
  )
}
