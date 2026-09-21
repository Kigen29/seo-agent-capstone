'use client'

import type { ContributorSearch } from '@seo/api-client'
import { useState, useTransition } from 'react'
import { findContributors } from './contributor-action'
import { OutreachPitch } from './outreach-pitch'

/**
 * Places that might publish this client.
 *
 * The competitor feature is LinkSeeker: a niche in, 44 "link building opportunities" out, emailed
 * as a PDF. Two differences here, and both are visible on screen rather than only in the code.
 *
 * The ask is coverage, not a link, because that is what the evidence supports: mentions correlate
 * 0.664 with AI Overview visibility against 0.218 for backlinks. And every candidate's page has
 * been read before it appears, with the ones selling placements shown as refused rather than
 * quietly dropped, so a client can see the filter working and argue with it.
 */
export function ContributorSearchPanel({ siteId }: { siteId: string }) {
  const [pending, start] = useTransition()
  const [niche, setNiche] = useState('')
  const [locale, setLocale] = useState('')
  const [result, setResult] = useState<ContributorSearch | null>(null)
  const [error, setError] = useState<string | null>(null)

  function search() {
    setError(null)
    start(async () => {
      const answer = await findContributors(siteId, niche.trim(), locale.trim())
      if ('error' in answer) {
        setError(answer.error)
        return
      }
      setResult(answer)
    })
  }

  return (
    <section className="mt-8">
      <h2 className="h-section mb-1">Places that might publish you</h2>
      <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
        Publications inviting contributors in your field. The ask is coverage, not a link: mentions
        correlate 0.664 with AI Overview visibility where backlinks correlate 0.218. Every page here
        has been read first, and anything selling placements is refused and named below, because
        buying those is the one tactic that can actively cost you.
      </p>

      <div className="card elev-sm gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="card-kicker">What you do</span>
            <input
              className="input"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              placeholder="floor tiles"
              spellCheck={false}
            />
          </label>

          <label className="flex w-[12rem] shrink-0 flex-col gap-1">
            <span className="card-kicker">Market (optional)</span>
            <input
              className="input"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              placeholder="Kenya"
              spellCheck={false}
            />
          </label>

          <button
            type="button"
            className="btn btn-primary shrink-0"
            onClick={search}
            disabled={pending || niche.trim().length < 3}
          >
            {pending ? 'Searching…' : 'Find them'}
          </button>
        </div>

        <p className="text-muted m-0 text-[13px]">
          This runs billed searches and then reads each page it found, so it takes a few seconds.
        </p>
      </div>

      {error && (
        <p className="mt-3 text-[13px]" role="alert" style={{ color: 'var(--color-neutral-800)' }}>
          {error}
        </p>
      )}

      {result?.note && <p className="text-muted mt-3 mb-0 text-[13px]">{result.note}</p>}

      {result && result.opportunities.length > 0 && (
        <div className="card elev-sm mt-4 gap-0 p-0">
          {result.opportunities.map((candidate, index) => (
            <div
              key={candidate.domain}
              className="p-3"
              style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
            >
              <a
                href={candidate.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm break-all"
              >
                {candidate.domain}
              </a>
              {candidate.title && (
                <p className="text-muted mt-1 mb-0 text-[12px]">{candidate.title}</p>
              )}
              <OutreachPitch siteId={siteId} domain={candidate.domain} />
            </div>
          ))}
        </div>
      )}

      {result && result.opportunities.length === 0 && !result.note && (
        <p className="text-muted mt-3 mb-0 text-[13px]">
          Nothing survived the check. That is a real answer for a narrow niche: the pages that
          matched were either selling placements or not inviting contributions at all.
        </p>
      )}

      {result && result.refused.length > 0 && (
        <details className="mt-4">
          <summary className="text-muted cursor-pointer text-[13px]">
            {result.refused.length} refused for selling placements
          </summary>
          <ul className="text-muted mt-2 grid gap-2 pl-5 text-[13px]">
            {result.refused.map((candidate) => (
              <li key={candidate.domain}>
                <span className="break-all">{candidate.domain}</span>
                {candidate.matched.length > 0 && <> — {candidate.matched.slice(0, 3).join(', ')}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
