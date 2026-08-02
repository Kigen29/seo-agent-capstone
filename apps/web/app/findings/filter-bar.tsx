'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AXIS_LABEL, SEVERITIES, STATUSES } from './labels'

/**
 * Search, and four filters, all of which the server applies.
 *
 * The inbox previously offered four hardcoded chips (all / critical / fixable / needs input) and
 * applied them in the browser to the entire downloaded backlog. You could not filter by site, by
 * axis, or by status, and status was fetched and never rendered at all, so there was no way to see
 * which findings already had a pull request open.
 *
 * State lives in the URL rather than in this component. That makes a filtered view shareable and
 * bookmarkable, it survives a refresh, and it means the server component below re-runs the query
 * rather than this one holding a second copy of the data. Changing any control also resets to page
 * one, because staying on page 7 of a filter that now matches four rows shows an empty table.
 */
export function FilterBar({ siteOptions }: { siteOptions: { id: string; url: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [q, setQ] = useState(params.get('q') ?? '')

  function apply(next: Record<string, string>) {
    const search = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value)
      else search.delete(key)
    }
    search.delete('page')
    router.push(`${pathname}?${search.toString()}`)
  }

  /**
   * Debounced, because a router push per keystroke is a server round trip per keystroke. 300ms is
   * long enough to coalesce typing and short enough not to feel laggy.
   *
   * The push is written out here rather than calling `apply`, so the dependency array can be
   * honest: `apply` is rebuilt on every render, and depending on it would fire the effect in a
   * loop. The equality check at the top makes the `params` dependency safe, since after the push
   * lands the URL already holds `q` and the effect returns immediately.
   */
  useEffect(() => {
    const current = params.get('q') ?? ''
    if (q === current) return

    const id = setTimeout(() => {
      const search = new URLSearchParams(params.toString())
      if (q) search.set('q', q)
      else search.delete('q')
      search.delete('page')
      router.push(`${pathname}?${search.toString()}`)
    }, 300)

    return () => clearTimeout(id)
  }, [q, params, pathname, router])

  const select = (name: string, label: string, options: { value: string; label: string }[]) => (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        className="input"
        aria-label={label}
        value={params.get(name) ?? ''}
        onChange={(event) => apply({ [name]: event.target.value })}
      >
        <option value="">{label}: any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )

  const hasFilters = ['q', 'siteId', 'axis', 'severity', 'status', 'fixable'].some((key) =>
    params.get(key),
  )

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex min-w-50 flex-1 flex-col gap-1">
        <span className="sr-only">Search findings</span>
        <input
          type="search"
          className="input"
          placeholder="Search titles and rule ids"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </label>

      {siteOptions.length > 1 &&
        select(
          'siteId',
          'Site',
          siteOptions.map((site) => ({ value: site.id, label: hostOf(site.url) })),
        )}

      {select(
        'axis',
        'Axis',
        Object.entries(AXIS_LABEL).map(([value, label]) => ({ value, label })),
      )}
      {select(
        'severity',
        'Severity',
        SEVERITIES.map((value) => ({ value, label: value })),
      )}
      {select(
        'status',
        'Status',
        STATUSES.map((value) => ({ value, label: value.replace('_', ' ') })),
      )}
      {select('fixable', 'Type', [
        { value: 'true', label: 'Fixable in code' },
        { value: 'false', label: 'Needs input' },
      ])}

      {hasFilters && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => router.push(pathname)}
        >
          Clear
        </button>
      )}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
