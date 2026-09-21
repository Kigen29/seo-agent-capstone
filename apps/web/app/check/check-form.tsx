'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { runCheck, type CheckState } from './actions'

/**
 * The form a stranger sees first.
 *
 * Two things it has to do that a signed-in form does not. It has to be honest about the wait:
 * this runs on a free tier that sleeps, a cold start has measured 33.6 seconds, and a spinner
 * with no explanation reads as broken (ADR-0025). And it has to fail in words a visitor can act
 * on, because every failure here is theirs to fix: a site that did not answer, a URL that is not
 * https, a daily limit reached.
 */
export function CheckForm() {
  const router = useRouter()
  const [state, action, pending] = useActionState<CheckState, FormData>(runCheck, {})

  useEffect(() => {
    if (state.id) router.push(`/check/${state.id}`)
  }, [state.id, router])

  return (
    <div>
      <form action={action} className="card elev-sm gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="card-kicker">Your website</span>
            <input
              name="url"
              className="input"
              placeholder="example.com"
              autoComplete="url"
              spellCheck={false}
              required
            />
          </label>

          <button type="submit" className="btn btn-primary shrink-0" disabled={pending}>
            {pending ? 'Checking…' : 'Check it'}
          </button>
        </div>

        <p className="text-muted m-0 text-[13px]">
          No account, no email. One page, its robots.txt, its sitemap and its llms.txt. The checker
          sleeps when nobody is using it, so the first run of the day can take up to a minute to
          wake up.
        </p>
      </form>

      {state.error && (
        <div className="note note-error mt-4" role="alert">
          {state.error}{' '}
          {state.error.includes('limit') && (
            <Link href="/login">Sign in to audit a whole site</Link>
          )}
        </div>
      )}
    </div>
  )
}
