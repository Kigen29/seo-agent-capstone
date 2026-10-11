'use client'

import { useState } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { setFindingStatus } from './actions'

/**
 * Say that a finding will not be acted on, or take that back (ADR-0050).
 *
 * "Won't fix" has been a status since the first schema, and an audit has always carried it
 * forward to the same finding on the next one. There was no way to set it. A finding somebody
 * had decided to live with stayed in every count, and came back at the top of every list.
 *
 * Quiet on purpose. It is the least important thing a person can do with a finding, so it is a
 * ghost button under the real action, and a dismissed finding says so plainly with one way back.
 * Nothing is deleted: the finding and its evidence stay, and so does the decision.
 *
 * The page is loaded again afterwards, and not refreshed in place. It was a `router.refresh()`
 * inside a transition, on the belief that this route has no loading file. It has one: the
 * `loading.tsx` beside the findings list covers this page as well. After a server action the
 * router does not reliably apply a page that arrives in two parts, and here that left the
 * button on "Dismissing..." for good about one press in four, with the change already stored.
 * The browser test found it on its fourth run. `authority/not-us.tsx` has the measurements.
 */
export function DismissFinding({ id, dismissed }: { id: string; dismissed: boolean }) {
  const [error, setError] = useState<UserError | null>(null)
  const [pending, setPending] = useState(false)

  async function set(status: 'open' | 'wontfix') {
    setError(null)
    setPending(true)
    const result = await setFindingStatus(id, status)
    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    // Left pending: the page is about to be replaced, and a second press must not get in first.
    window.location.reload()
  }

  return (
    <div className="mb-6 flex flex-col items-start gap-2">
      {dismissed ? (
        <div className="note note-info flex w-full flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="font-semibold">You dismissed this as won&rsquo;t fix.</span> It is left
            out of the list of what needs fixing, and stays dismissed when the site is audited
            again.
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm shrink-0"
            onClick={() => set('open')}
            disabled={pending}
          >
            {pending ? 'Reopening...' : 'Reopen'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => set('wontfix')}
          disabled={pending}
        >
          {pending ? 'Dismissing...' : 'Dismiss as won’t fix'}
        </button>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
