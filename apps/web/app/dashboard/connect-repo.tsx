'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { beginConnectRepo, chooseRepo } from './actions'

type Pick = { repos: { fullName: string }[]; manageUrl: string }

/**
 * Connect a repository to a site.
 *
 * The first repo a tenant connects is a fresh GitHub App install, so this sends the browser there.
 * Every repo after that, the App is already installed, so re-installing would drop our signed state
 * and look cancelled; instead this shows the repositories the App can already see and lets the user
 * pick one. No guessing a repo from the site's name: a repo can be called anything.
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
  const [error, setError] = useState<string | null>(null)

  function begin() {
    setError(null)
    start(async () => {
      const result = await beginConnectRepo(siteId)
      if (result.mode === 'install') {
        window.location.href = result.url
        return
      }
      if (result.mode === 'pick') {
        if (result.repos.length === 0) {
          window.location.href = result.manageUrl // installed but no repos granted yet
          return
        }
        setPick({ repos: result.repos, manageUrl: result.manageUrl })
        setSelected(result.repos[0]!.fullName)
        return
      }
      setError(result.message)
    })
  }

  function connect() {
    if (!selected) return
    setError(null)
    start(async () => {
      const result = await chooseRepo(siteId, selected)
      if (result.error) {
        setError(result.error)
        return
      }
      setPick(null)
      router.refresh()
    })
  }

  if (pick) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}
        >
          <select
            className="input"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            style={{ minWidth: 220 }}
            aria-label="Repository to connect"
          >
            {pick.repos.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={connect} disabled={pending}>
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
        <a href={pick.manageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
          Repository not listed? Grant the app access on GitHub &rarr;
        </a>
        {error && (
          <span style={{ fontSize: 12, color: 'var(--color-neutral-800)' }} role="alert">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <button type="button" className="btn btn-secondary" onClick={begin} disabled={pending}>
        {pending ? 'Loading...' : repoFullName ? 'Reconnect repo' : 'Connect repo'}
      </button>
      {error && (
        <span style={{ fontSize: 12, color: 'var(--color-neutral-800)' }} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
