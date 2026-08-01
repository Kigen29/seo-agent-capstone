'use client'

import { useState, useTransition } from 'react'
import { loadVisibility, saveVisibility } from './actions'

/**
 * The questions we ask the answer engines on this site's behalf.
 *
 * The only configuration the AI-visibility axis cannot infer for itself. Every other axis reads
 * something that already exists; this one needs a human to say what their customers actually ask,
 * so the copy pushes towards real questions rather than keywords. "safari kenya" is a search box
 * habit; nobody types that into ChatGPT.
 *
 * A textarea of one question per line, rather than a repeating row of inputs, because that is
 * what a list of twenty sentences wants to be: it pastes, it reorders, and it does not make a
 * user click "add" twenty times.
 */

/** Matches the API's cap. Enforced there; repeated here so the user is told before they submit. */
const MAX_PROMPTS = 20

const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const commasOf = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

export function VisibilityPrompts({ siteId, siteUrl }: { siteId: string; siteUrl: string }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [prompts, setPrompts] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const count = linesOf(prompts).length
  const tooMany = count > MAX_PROMPTS

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }

    setError(null)
    setSaved(null)
    start(async () => {
      const result = await loadVisibility(siteId)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setPrompts(result.prompts.join('\n'))
      setCompetitors(result.competitors.join(', '))
      setOpen(true)
    })
  }

  function save() {
    setError(null)
    setSaved(null)
    start(async () => {
      const result = await saveVisibility(siteId, {
        prompts: linesOf(prompts),
        competitors: commasOf(competitors),
      })

      if ('error' in result) {
        setError(result.error)
        return
      }

      // Render what was stored, not what was typed. The two differ often enough to matter:
      // competitors come back as bare hosts, and duplicates are gone.
      setPrompts(result.prompts.join('\n'))
      setCompetitors(result.competitors.join(', '))
      setSaved(
        result.prompts.length === 0
          ? 'Saved. With no questions, this axis stays unmeasured, and says so.'
          : `Saved ${result.prompts.length} question(s). Polling runs once a day; the first ` +
              'verdict lands after three days.',
      )
    })
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <button type="button" className="btn btn-ghost" onClick={toggle} disabled={pending}>
          {pending ? 'Loading...' : 'AI visibility prompts'}
        </button>
        {error && (
          <span style={{ fontSize: 12, color: 'var(--color-neutral-800)' }} role="alert">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-4)',
        marginTop: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <div className="card-kicker">AI visibility for {siteUrl}</div>
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 13, lineHeight: 1.6, opacity: 0.75 }}>
          One customer question per line, the way somebody would actually type it into ChatGPT. Real
          questions, not keywords: &ldquo;how much does a Kenyan safari cost&rdquo; rather than
          &ldquo;safari kenya price&rdquo;. Each one is polled once a day, and a citation is only
          reported once it holds across at least three checks over at least three days, because
          roughly 45% of citations show up in only one of three.
        </p>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          Questions ({count}/{MAX_PROMPTS})
        </span>
        <textarea
          className="input"
          rows={6}
          value={prompts}
          onChange={(event) => setPrompts(event.target.value)}
          placeholder={'how much does a kenyan safari cost\nbest safari operator in nairobi'}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          Competitor domains, comma separated. Share of voice is measured against these.
        </span>
        <input
          className="input"
          value={competitors}
          onChange={(event) => setCompetitors(event.target.value)}
          placeholder="rivalsafaris.com, anothertour.co.ke"
        />
      </label>

      <div
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={pending || tooMany}
        >
          {pending ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Close
        </button>

        {tooMany && (
          <span style={{ fontSize: 12, color: 'var(--color-neutral-800)' }} role="alert">
            {count} questions is over the limit of {MAX_PROMPTS}. Each one is a poll a day, forever,
            so the cap is a cost ceiling.
          </span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: 'var(--color-neutral-800)' }} role="alert">
            {error}
          </span>
        )}
        {saved && !error && (
          <span style={{ fontSize: 12, opacity: 0.7 }} role="status">
            {saved}
          </span>
        )}
      </div>
    </div>
  )
}
