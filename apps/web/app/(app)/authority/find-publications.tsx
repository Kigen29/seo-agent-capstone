'use client'

import type { ContributorSearch } from '@seo/api-client'
import { useId, useState, useTransition } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import type { UserError } from '@/lib/user-error'
import { findContributors } from './contributor-action'
import { Empty, Lead } from './outreach-parts'

/** Matches the API's limit on the niche. */
const NICHE_MAX = 120

/** One publication a person could write to. Shared by the three lists on the workbench. */
export interface Target {
  domain: string
  /** Where the row links to. Defaults to the domain's homepage. */
  url?: string
  /** A line under the domain: a page title, when there is one. */
  detail?: string
}

/**
 * Publications that invite contributors in the client's field.
 *
 * The ask is coverage, not a link, because that is what the evidence supports. And every
 * candidate's page has been read before it appears, with the ones selling placements shown as
 * refused rather than quietly dropped, so a client can see the filter working and argue with it.
 */
export function FindPublications({
  siteId,
  market,
  result,
  onResult,
  children,
}: {
  siteId: string
  market: string
  result: ContributorSearch | null
  onResult: (result: ContributorSearch) => void
  children: (candidates: Target[]) => React.ReactNode
}) {
  const id = useId()
  const [niche, setNiche] = useState('')
  const [locale, setLocale] = useState(market)
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()

  function search(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const answer = await findContributors(siteId, niche.trim(), locale.trim())
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      onResult(answer.data)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Lead>
        Publications in your field that invite outside writers. Each page is read before it is
        listed, and any that sell placements are refused and named, because paying for those is the
        one tactic that can cost you rankings.
      </Lead>

      <form onSubmit={search} className="card" style={{ padding: 'var(--space-5)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <Field
              id={`${id}-niche`}
              label="Your topic, in two or three words"
              hint={{
                about: 'how the topic is searched',
                body: 'It is searched as an exact phrase, so use the words a publication would use for its subject, such as "safari tours" or "Kenya travel", not a description of your business. The search is paid for from your monthly allowance and reads each page it finds, so it takes a few seconds.',
              }}
            >
              <input
                id={`${id}-niche`}
                className="input"
                value={niche}
                onChange={(event) => setNiche(event.target.value)}
                placeholder="safari tours"
                spellCheck={false}
                maxLength={NICHE_MAX}
              />
            </Field>
          </div>
          <div className="w-[12rem]">
            <Field id={`${id}-market`} label="Market (optional)">
              <input
                id={`${id}-market`}
                className="input"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
                placeholder="Kenya"
                spellCheck={false}
              />
            </Field>
          </div>
          <button
            type="submit"
            className="btn btn-primary shrink-0"
            disabled={pending || niche.trim().length < 3}
          >
            {pending ? 'Searching...' : 'Find publications'}
          </button>
        </div>
      </form>

      <ErrorNote error={error} />

      {result?.note && <div className="text-muted text-[13px]">{result.note}</div>}

      {result &&
        result.opportunities.length > 0 &&
        children(
          result.opportunities.map((candidate) => ({
            domain: candidate.domain,
            url: candidate.url,
            ...(candidate.title ? { detail: candidate.title } : {}),
          })),
        )}

      {result && result.opportunities.length === 0 && !result.note && (
        <Empty>
          Nothing passed the check. For a narrow topic that is a real answer: the pages found were
          either selling placements or not inviting writers at all. Try a broader phrase.
        </Empty>
      )}

      {result && result.refused.length > 0 && (
        <details>
          <summary className="text-muted cursor-pointer text-[13px]">
            {result.refused.length} refused for selling placements
          </summary>
          <ul className="text-muted mt-2 grid gap-2 pl-5 text-[13px]">
            {result.refused.map((candidate) => (
              <li key={candidate.domain}>
                <span className="break-all">{candidate.domain}</span>
                {candidate.matched.length > 0 && <>: {candidate.matched.slice(0, 3).join(', ')}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
