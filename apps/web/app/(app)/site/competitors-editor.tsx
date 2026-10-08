'use client'

import type { CompetitorSuggestion } from '@seo/api-client'
import { useState, useTransition } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import { invalid, type UserError } from '@/lib/user-error'
import { saveCompetitors, suggestCompetitors } from './actions'
import { CompetitorName } from './competitor-name'

/**
 * The competitors a site is compared with: suggested first, typed if you know better.
 *
 * Suggestions are offered, never applied. Each one has been fetched and has answered, and shows
 * the title of its own homepage beside the reason it was suggested, so the choice does not rest
 * on a model's word. Nothing is tracked until it is ticked and added.
 *
 * Every change saves at once. There is no separate Save button to forget, and the list on screen
 * is always the list that is stored.
 */

/** The same limit the API enforces, so the page can say so before a request is refused. */
const MAX = 10

const bare = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')

export function CompetitorsEditor({
  siteId,
  initial,
  names: initialNames,
  onChange,
}: {
  /**
   * What each competitor is called, by domain. Passed where naming them belongs: the site setup
   * page and the competitors page. Left out in onboarding, where a competitor added a moment ago
   * has not been read yet and the line would only say so ten times.
   */
  names?: Record<string, string | null>
  siteId: string
  initial: string[]
  onChange?: (competitors: string[]) => void
}) {
  const [tracked, setTracked] = useState(initial)
  const [names, setNames] = useState(initialNames)
  const [typed, setTyped] = useState('')
  const [suggestions, setSuggestions] = useState<CompetitorSuggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()
  const [suggesting, startSuggesting] = useTransition()

  const room = MAX - tracked.length

  function store(next: string[]) {
    setError(null)
    start(async () => {
      const result = await saveCompetitors(siteId, next)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTracked(result.data)
      onChange?.(result.data)
    })
  }

  function addTyped(event: React.FormEvent) {
    event.preventDefault()
    const domain = bare(typed)
    if (!domain) return
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      setError(
        invalid(
          'That is not a web address',
          'Give the competitor as its domain, like rivalsafaris.com, without spaces.',
        ),
      )
      return
    }
    if (tracked.includes(domain)) {
      setTyped('')
      return
    }
    setTyped('')
    store([...tracked, domain])
  }

  function suggest() {
    setError(null)
    setNote(null)
    startSuggesting(async () => {
      const result = await suggestCompetitors(siteId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const { suggestions: found, dropped, basedOn } = result.data
      setSuggestions(found)
      setPicked(new Set())

      const parts: string[] = []
      if (found.length === 0) parts.push('Nothing suggested held up when checked.')
      if (dropped > 0) {
        parts.push(
          `${dropped} suggested ${dropped === 1 ? 'site' : 'sites'} did not answer and ${dropped === 1 ? 'was' : 'were'} left out.`,
        )
      }
      if (!basedOn.offering) {
        parts.push('Say what you offer in the details above and the suggestions get more specific.')
      }
      setNote(parts.length > 0 ? parts.join(' ') : null)
    })
  }

  function addPicked() {
    const chosen = (suggestions ?? []).map((entry) => entry.domain).filter((d) => picked.has(d))
    const next = [...new Set([...tracked, ...chosen])].slice(0, MAX)
    setSuggestions((current) => (current ?? []).filter((entry) => !picked.has(entry.domain)))
    setPicked(new Set())
    store(next)
  }

  const offered = (suggestions ?? []).filter((entry) => !tracked.includes(entry.domain))

  return (
    <div className="flex flex-col gap-4">
      {tracked.length > 0 ? (
        <div className="frame">
          <ul className="m-0 list-none p-0">
            {tracked.map((domain, index) => (
              <li
                key={domain}
                className="flex items-start justify-between gap-3 px-4 py-2.5"
                style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{domain}</div>
                  {names && (
                    <CompetitorName
                      siteId={siteId}
                      domain={domain}
                      name={names[domain]}
                      onSaved={setNames}
                    />
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  disabled={pending}
                  onClick={() => store(tracked.filter((entry) => entry !== domain))}
                >
                  Remove<span className="sr-only"> {domain}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-muted text-sm">
          No competitors yet. Share of voice and the weekly competitor watch both need at least one.
        </div>
      )}

      <div className="card" style={{ padding: 'var(--space-5)', gap: 'var(--space-3)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="card-heading">Suggested for you</div>
            <div className="text-muted mt-1 text-[13px]">
              Drafted from what you offer and where, then each one checked to be a real site.
            </div>
          </div>
          <button
            type="button"
            className={suggestions === null ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={suggest}
            disabled={suggesting || room <= 0}
          >
            {suggesting
              ? 'Looking...'
              : suggestions === null
                ? 'Suggest competitors'
                : 'Suggest again'}
          </button>
        </div>

        {offered.length > 0 && (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {offered.map((entry) => (
                <li key={entry.domain}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.has(entry.domain)}
                      onChange={(event) => {
                        const next = new Set(picked)
                        if (event.target.checked) next.add(entry.domain)
                        else next.delete(entry.domain)
                        setPicked(next)
                      }}
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">{entry.domain}</span>
                      {entry.title && (
                        <span className="text-muted text-[13px]"> &middot; {entry.title}</span>
                      )}
                      <span className="text-muted block text-[13px]">{entry.reason}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending || picked.size === 0 || picked.size > room}
                onClick={addPicked}
              >
                {picked.size === 0
                  ? 'Tick the ones that compete with you'
                  : `Add ${picked.size} selected`}
              </button>
            </div>
          </>
        )}

        {note && <div className="text-muted text-[13px]">{note}</div>}
      </div>

      <form onSubmit={addTyped} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="card-kicker">Add one yourself</span>
          <input
            className="input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="rivalsafaris.com"
            autoComplete="off"
            spellCheck={false}
            disabled={room <= 0}
          />
        </label>
        <button
          type="submit"
          className="btn btn-secondary"
          disabled={pending || room <= 0 || !typed.trim()}
        >
          Add
        </button>
      </form>

      {room <= 0 && (
        <div className="text-muted text-[13px]">
          That is the limit of {MAX}. Remove one to add another.
        </div>
      )}

      <ErrorNote error={error} />
    </div>
  )
}
