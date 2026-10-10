'use client'

import { useState } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { setMentionExclusions } from './not-us-action'

/**
 * "Not us": the client's own word on which sites are about another business.
 *
 * A page can contain the brand name and still be about somebody else, when two companies share
 * the name. Nothing in the page can settle that and no check here pretends to. The person who
 * owns the business can tell at a glance, so each site in the list carries one small control.
 *
 * The whole list is sent on every change, and the page is then loaded again, so the figures at
 * the top and the lists below always agree with what was stored.
 *
 * A full reload, and not an in-place update, and the reason is measured (10 October 2026).
 *
 * An in-place update left the old figures on screen about half the time. The save was stored,
 * the API answered with the new figures, the server rendered the right page and the browser read
 * every byte of it; the router then did or did not show it. That held for every arrangement: a
 * `router.refresh()` after the action, inside a transition and outside one, deferred or not, and
 * `revalidatePath` in the action with no refresh at all. It did not depend on how long the page
 * had been idle.
 *
 * The cause is this route's `loading.tsx`. Clicking the button nine times in a row landed the
 * update 4 times with the loading file in place and 9 times with it taken away, nothing else
 * changed. A loading file makes the page arrive in two parts, and after a server action the
 * router does not reliably apply the second.
 *
 * The loading file stays, because it is what a reader sees while the sleeping API wakes up,
 * which is the more common wait by far. So these two controls reload, which was right every
 * time it was measured. The browser puts the reader back where they were, and marking a site is
 * a rare act. Do not replace this with a refresh without repeating that measurement: a single
 * passing run proves nothing here, and misled this file's author twice.
 */
function reloadPage(): void {
  window.location.reload()
}

export function NotUsButton({
  siteId,
  domain,
  excluded,
}: {
  siteId: string
  domain: string
  /** The current list, so one more can be added to it. */
  excluded: string[]
}) {
  const [error, setError] = useState<UserError | null>(null)
  const [pending, setPending] = useState(false)

  async function exclude() {
    setError(null)
    setPending(true)
    const result = await setMentionExclusions(siteId, [...excluded, domain])
    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    // Left pending: the page is about to be replaced, and a second click must not get in first.
    reloadPage()
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={exclude}
        disabled={pending}
        title="This site is about a different business"
      >
        {pending ? 'Removing...' : 'Not us'}
        <span className="sr-only">: {domain} is about a different business</span>
      </button>
      {error && (
        <div className="basis-full">
          <ErrorNote error={error} />
        </div>
      )}
    </>
  )
}

/** The sites already excluded, each with a way back. */
export function ExcludedSites({ siteId, excluded }: { siteId: string; excluded: string[] }) {
  const [error, setError] = useState<UserError | null>(null)
  const [pending, setPending] = useState(false)

  if (excluded.length === 0) return null

  async function restore(domain: string) {
    setError(null)
    setPending(true)
    const result = await setMentionExclusions(
      siteId,
      excluded.filter((entry) => entry !== domain),
    )
    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    reloadPage()
  }

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[13px]">
        {excluded.length} {excluded.length === 1 ? 'site' : 'sites'} you marked as not you
      </summary>
      <div className="text-muted mt-2 mb-2 max-w-[68ch] text-[13px]">
        Left out of the figures and lists on this page, and of every audit from now on. A finding
        already raised about one of them stays until the next audit.
      </div>
      <ul className="frame m-0 list-none p-0">
        {excluded.map((domain, index) => (
          <li
            key={domain}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
            style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
          >
            <span className="min-w-0 break-all">{domain}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm shrink-0"
              disabled={pending}
              onClick={() => restore(domain)}
            >
              Put back<span className="sr-only"> {domain}</span>
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} className="mt-2" />
    </details>
  )
}
