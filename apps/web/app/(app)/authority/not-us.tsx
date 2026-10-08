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
 * A full reload, and not the router's in-place refresh. With a refresh, the browser test showed
 * the change stored and the API answering with the new figures while this page went on showing
 * the old ones, in every arrangement tried: inside a transition, outside one, with the path
 * revalidated and without. Why was not established. A reload was measured to show the right
 * page every time, the browser puts the reader back where they were, and marking a site is a
 * rare enough act that the difference is not worth an unexplained stale screen.
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
