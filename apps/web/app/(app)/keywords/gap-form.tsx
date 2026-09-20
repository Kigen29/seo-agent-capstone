'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * The competitor whose rankings to read, submitted into the URL.
 *
 * Same shape as the seed form and for the same reason: every run is a billed query, so it happens
 * when somebody presses a button, and the result is a URL you can bookmark rather than something
 * paid for twice.
 *
 * The site selector is deliberately absent. The gap is measured against *this* site's Search
 * Console data, so the site is whichever one the page is already showing, and an extra control
 * offering to mix one site's rankings with another's would invite a comparison that means nothing.
 */
export function GapForm({
  competitor,
  country,
  siteUrl,
  seed,
}: {
  competitor: string
  country: string
  siteUrl: string
  /** Carried through so running a gap does not silently discard a keyword search above it. */
  seed: string
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [value, setValue] = useState(competitor)
  const [pending, setPending] = useState(false)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const rival = value.trim()
    if (!rival) return

    setPending(true)
    const search = new URLSearchParams()
    if (seed.trim()) search.set('seed', seed.trim())
    if (country.trim()) search.set('country', country.trim().toLowerCase())
    search.set('competitor', rival.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
    router.push(`${pathname}?${search.toString()}`)
  }

  return (
    <form onSubmit={submit} className="card elev-sm gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="card-kicker">Competitor domain</span>
          <input
            name="competitor"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setPending(false)
            }}
            placeholder="tileandcarpet.co.ke"
            autoComplete="off"
            spellCheck={false}
            className="input"
            aria-describedby="gap-help"
          />
        </label>

        <button type="submit" className="btn btn-primary shrink-0" disabled={!value.trim()}>
          {pending ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      <p id="gap-help" className="text-muted m-0 text-[13px]">
        What they rank for and {siteUrl} does not. Keywords your own Search Console says you already
        appear for are removed first, because a third-party index sees a small site badly and would
        otherwise sell you terms you already have. One billed query per comparison.
      </p>
    </form>
  )
}
