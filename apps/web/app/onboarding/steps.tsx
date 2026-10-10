'use client'

import type { SiteProfile, SuggestedPrompt } from '@seo/api-client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addQuestions, suggestQuestions } from '@/app/(app)/site/actions'
import { CompetitorsEditor } from '@/app/(app)/site/competitors-editor'
import { ProfileForm } from '@/app/(app)/site/profile-form'
import { ErrorNote } from '@/components/ui/error-note'
import { PickTable } from '@/components/ui/pick-table'
import type { UserError } from '@/lib/user-error'
import { createSite } from './actions'

/**
 * The interactive half of each onboarding step.
 *
 * Every step saves as it goes and then moves the address on, so the flow can be left at any point
 * and picked up from the same URL. Nothing is held only in the browser: a refresh half way through
 * loses nothing, and the same forms on the site setup page show what was entered here.
 */

const stepUrl = (siteId: string, step: string): string =>
  `/onboarding?siteId=${siteId}&step=${step}`

/** Step one: the site itself. Everything after it is about this address. */
export function SiteStep({ initialUrl }: { initialUrl: string }) {
  const router = useRouter()
  const [url, setUrl] = useState(initialUrl)
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const result = await createSite(url)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(stepUrl(result.data.siteId, 'business'))
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="card-kicker">Your website</span>
        <input
          className="input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="example.com"
          inputMode="url"
          autoComplete="url"
          autoFocus
          spellCheck={false}
        />
      </label>

      <ErrorNote error={error} />

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending || !url.trim()}>
          {pending ? 'Reading your homepage...' : 'Continue'}
        </button>
      </div>
    </form>
  )
}

/** Step two: the name, the offer and the market. The name is usually already there. */
export function BusinessStep({ siteId, profile }: { siteId: string; profile: SiteProfile }) {
  const router = useRouter()

  return (
    <ProfileForm
      siteId={siteId}
      profile={profile}
      submitLabel="Save and continue"
      onSaved={() => router.push(stepUrl(siteId, 'competitors'))}
    />
  )
}

/** Step three: competitors. Each change saves at once, so Continue has nothing left to save. */
export function CompetitorsStep({ siteId, initial }: { siteId: string; initial: string[] }) {
  const [count, setCount] = useState(initial.length)

  return (
    <div className="flex flex-col gap-5">
      <CompetitorsEditor
        siteId={siteId}
        initial={initial}
        onChange={(list) => setCount(list.length)}
      />
      <StepFooter
        back={stepUrl(siteId, 'business')}
        next={stepUrl(siteId, 'questions')}
        nextLabel={count > 0 ? 'Continue' : 'Skip for now'}
        primary={count > 0}
      />
    </div>
  )
}

const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** Step four: the questions to ask AI assistants. Suggested from the site, or typed. */
export function QuestionsStep({ siteId, tracked }: { siteId: string; tracked: number }) {
  const router = useRouter()
  const [suggestions, setSuggestions] = useState<SuggestedPrompt[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [own, setOwn] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<UserError | null>(null)
  const [suggesting, startSuggesting] = useTransition()
  const [saving, startSaving] = useTransition()

  const chosen = [...picked, ...linesOf(own)]

  function suggest() {
    setError(null)
    startSuggesting(async () => {
      const result = await suggestQuestions(siteId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuggestions(result.data.suggestions)
      // Ticked to begin with: the common case is "these are fine", and unticking one is quicker
      // than ticking eight.
      setPicked(new Set(result.data.suggestions.map((entry) => entry.prompt)))
      setNote(result.data.note ?? null)
    })
  }

  function save() {
    setError(null)
    startSaving(async () => {
      const result = await addQuestions(siteId, chosen)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(stepUrl(siteId, 'finish'))
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {tracked > 0 && (
        <div className="note note-ok">
          {tracked} {tracked === 1 ? 'question is' : 'questions are'} already tracked. Anything you
          add here joins them.
        </div>
      )}

      <div className="card" style={{ padding: 'var(--space-5)', gap: 'var(--space-3)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="card-heading">Suggested for you</div>
            <div className="text-muted mt-1 text-[13px]">
              Drafted from your homepage and what you said you offer.
            </div>
          </div>
          <button
            type="button"
            className={suggestions === null ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={suggest}
            disabled={suggesting}
          >
            {suggesting
              ? 'Drafting...'
              : suggestions === null
                ? 'Suggest questions'
                : 'Suggest again'}
          </button>
        </div>

        {suggestions && suggestions.length > 0 && (
          <PickTable
            label="Suggested questions"
            heading="Suggested question"
            picked={picked}
            onChange={setPicked}
            items={suggestions.map((entry) => ({
              key: entry.prompt,
              title: entry.prompt,
              detail: entry.reason,
            }))}
          />
        )}

        {note && <div className="text-muted text-[13px]">{note}</div>}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="card-kicker">Or write your own, one per line</span>
        <textarea
          className="input"
          rows={3}
          value={own}
          onChange={(event) => setOwn(event.target.value)}
          placeholder="how much does a kenyan safari cost"
          style={{ resize: 'vertical' }}
        />
      </label>

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={stepUrl(siteId, 'competitors')} className="btn btn-ghost">
          Back
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={stepUrl(siteId, 'finish')} className="btn btn-ghost">
            Skip for now
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={saving || chosen.length === 0}
          >
            {saving
              ? 'Saving...'
              : chosen.length === 0
                ? 'Track questions'
                : `Track ${chosen.length} and continue`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Back on the left, onward on the right, in the same place on every step. */
export function StepFooter({
  back,
  next,
  nextLabel,
  primary,
}: {
  back: string
  next: string
  nextLabel: string
  primary: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href={back} className="btn btn-ghost">
        Back
      </Link>
      <Link href={next} className={primary ? 'btn btn-primary' : 'btn btn-secondary'}>
        {nextLabel}
      </Link>
    </div>
  )
}
