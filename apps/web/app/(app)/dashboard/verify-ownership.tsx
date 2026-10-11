'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ErrorNote, SavedNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { requestVerification } from './actions'

/**
 * The button that asks for a site's ownership to be verified, and says what came of asking.
 *
 * It used to be a form that redirected to the dashboard with a banner. Pressed from the site
 * setup page, that took the person away from the row they were looking at, to a page about
 * something else, with a sentence that was the same whatever had gone wrong. The work itself
 * happens on a worker minutes later, so the page they landed on showed no change either. From
 * where they sat, nothing had happened.
 *
 * So the answer stays here. A refusal is shown in the API's own words, next to the button. An
 * accepted request says what will happen and roughly when, and where the result will appear:
 * on this row, which a failure also writes to.
 */
export function VerifyOwnership({ siteId, retry }: { siteId: string; retry: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<UserError | null>(null)
  const [started, setStarted] = useState(false)
  const [pending, start] = useTransition()

  function ask() {
    setError(null)
    start(async () => {
      const result = await requestVerification(siteId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStarted(true)
      // The last failure, if there was one, has just been cleared on the server.
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {!started && (
        <button type="button" className="btn btn-primary btn-sm" onClick={ask} disabled={pending}>
          {pending ? 'Asking...' : retry ? 'Try again' : 'Verify ownership'}
        </button>
      )}
      {started && (
        <SavedNote className="max-w-[44ch] text-left">
          Started. It usually takes a few minutes. If your Google account already has this site
          verified, this row turns to Verified. If not, a pull request appears here to review. If it
          cannot be done, this row says why.
        </SavedNote>
      )}
      <ErrorNote error={error} className="max-w-[44ch] text-left" />
    </div>
  )
}
