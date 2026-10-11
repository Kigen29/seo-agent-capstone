'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
 */
export function DismissFinding({ id, dismissed }: { id: string; dismissed: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()

  function set(status: 'open' | 'wontfix') {
    setError(null)
    start(async () => {
      const result = await setFindingStatus(id, status)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // No loading file on this route, so a refresh redraws the page in place.
      router.refresh()
    })
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
