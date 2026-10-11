'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import type { RepoAccount } from '@seo/api-client'
import { filterRepos, repoAccessNotes, SEARCH_REPOS_FROM } from '@/lib/repo-access'
import type { UserError } from '@/lib/user-error'
import { beginConnectRepo, chooseRepo } from './actions'

type Pick = { repos: { fullName: string }[]; manageUrl: string; accounts?: RepoAccount[] }

/**
 * Connect a repository to a site.
 *
 * The first repo a tenant connects is a fresh GitHub App install, so this sends the browser there.
 * Every repo after that, the App is already installed, so re-installing would drop our signed state
 * and look cancelled; instead this shows the repositories the App can already see and lets the user
 * pick one. No guessing a repo from the site's name: a repo can be called anything.
 *
 * The picker says what its list is. The App sees only what it was granted, so somebody who
 * ticked three repositories at install was shown those three and nothing else, with no sign
 * that the rest of their account existed. Each account now gets a sentence saying whether the
 * list is all of it, and when it is not, a button to the one page on GitHub that changes that.
 * GitHub sends them back here afterwards (the App's "redirect on update" setting).
 *
 * Past a handful of repositories the list has a search box, and while something is typed the
 * matches are shown as an open list and not behind a closed menu. An account granted whole can
 * hold hundreds, and a closed menu of hundreds is found by scrolling.
 */
export function ConnectRepo({
  siteId,
  repoFullName,
}: {
  siteId: string
  repoFullName: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [pick, setPick] = useState<Pick | null>(null)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<UserError | null>(null)

  function begin() {
    setError(null)
    start(async () => {
      const answer = await beginConnectRepo(siteId)
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      const result = answer.data
      if (result.mode === 'install') {
        window.location.href = result.url
        return
      }
      if (result.mode === 'pick') {
        if (result.repos.length === 0) {
          // Installed with nothing granted: the only useful place is where that is changed.
          window.location.href = result.accounts?.[0]?.manageUrl ?? result.manageUrl
          return
        }
        setPick({
          repos: result.repos,
          manageUrl: result.manageUrl,
          ...(result.accounts ? { accounts: result.accounts } : {}),
        })
        setSelected(result.repos[0]!.fullName)
        setQuery('')
      }
    })
  }

  function connect(repo: string) {
    if (!repo) return
    setError(null)
    start(async () => {
      const result = await chooseRepo(siteId, repo)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPick(null)
      router.refresh()
    })
  }

  if (pick) {
    const notes = repoAccessNotes(pick.accounts, pick.repos)
    const searchable = pick.repos.length >= SEARCH_REPOS_FROM
    const shown = filterRepos(pick.repos, query)
    const searching = query.trim() !== ''
    // What Connect will use: the choice if it is still on show, or the first match.
    const chosen = shown.some((repo) => repo.fullName === selected)
      ? selected
      : (shown[0]?.fullName ?? '')

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}
        >
          {searchable && (
            <input
              type="search"
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter connects the first match, so a search can be finished from the keyboard.
                if (event.key === 'Enter' && chosen && !pending) connect(chosen)
              }}
              placeholder={`Search ${pick.repos.length} repositories`}
              aria-label="Search repositories"
              autoComplete="off"
              spellCheck={false}
              style={{ minWidth: 220, flex: '1 1 100%' }}
            />
          )}
          {shown.length > 0 ? (
            <select
              className="input"
              value={chosen}
              onChange={(event) => setSelected(event.target.value)}
              // An open list while searching, so the matches are read and not hunted for.
              size={searching ? Math.min(8, Math.max(2, shown.length)) : undefined}
              style={{ minWidth: 220, ...(searching ? { height: 'auto', flex: '1 1 100%' } : {}) }}
              aria-label="Repository to connect"
            >
              {shown.map((repo) => (
                <option key={repo.fullName} value={repo.fullName}>
                  {repo.fullName}
                </option>
              ))}
            </select>
          ) : (
            <p role="status" style={{ flex: '1 1 100%', fontSize: 14 }}>
              No repository matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => connect(chosen)}
            disabled={pending || !chosen}
          >
            {pending ? 'Connecting...' : 'Connect'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPick(null)}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
        {notes.map((note) => (
          <div key={note.login} className="note note-info max-w-[60ch] text-left">
            <p>{note.text}</p>
            {note.manageUrl && (
              <>
                <p className="mt-2">
                  To choose from all of them, open GitHub, select{' '}
                  <span className="font-semibold">All repositories</span> (or tick the ones you
                  want) and press Save. You are brought back here.
                </p>
                <a href={note.manageUrl} className="btn btn-secondary btn-sm mt-2">
                  Show all my repositories
                </a>
              </>
            )}
          </div>
        ))}
        {notes.length === 0 && (
          <a href={pick.manageUrl} style={{ fontSize: 12 }}>
            Repository not listed? Grant the app access on GitHub &rarr;
          </a>
        )}
        <ErrorNote error={error} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <button
        type="button"
        className={repoFullName ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
        onClick={begin}
        disabled={pending}
      >
        {pending ? 'Loading...' : repoFullName ? 'Change repo' : 'Connect repo'}
      </button>
      <ErrorNote error={error} />
    </div>
  )
}
