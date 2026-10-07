'use client'

import { useId, useState, useTransition } from 'react'
import { ErrorNote, SavedNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import type { UserError } from '@/lib/user-error'
import { loadQuestions, saveQuestions } from './actions'

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
 *
 * Questions and nothing else. The brand name and the competitors were edited here once; they are
 * on the site setup page now, and saving here leaves them exactly as they are.
 */

/** Matches the API's cap. Enforced there; repeated here so the user is told before they submit. */
const MAX_PROMPTS = 20

const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

export function VisibilityPrompts({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [prompts, setPrompts] = useState('')
  const [error, setError] = useState<UserError | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const id = useId()

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
      const result = await loadQuestions(siteId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPrompts(result.data.join('\n'))
      setOpen(true)
    })
  }

  function save() {
    setError(null)
    setSaved(null)
    start(async () => {
      const result = await saveQuestions(siteId, linesOf(prompts))
      if (!result.ok) {
        setError(result.error)
        return
      }

      // Render what was stored, not what was typed: duplicates are gone and lines are trimmed.
      setPrompts(result.data.join('\n'))
      setSaved(
        result.data.length === 0
          ? 'Saved. With no questions, AI visibility is not measured, and the page says so.'
          : `Saved ${result.data.length} ${result.data.length === 1 ? 'question' : 'questions'}. ` +
              'Each is asked once a day, and the first verdict arrives after three days.',
      )
    })
  }

  if (!open) {
    /**
     * `items-start`, so the trigger is the width of its own label. Inside a flex column a
     * stretched child made this button span the whole card and centre its text, so it read as a
     * heading rather than a control.
     */
    return (
      <div className="flex flex-col items-start gap-2">
        <button type="button" className="btn btn-secondary" onClick={toggle} disabled={pending}>
          {pending ? 'Loading...' : 'Edit tracked questions'}
        </button>
        <ErrorNote error={error} />
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)', gap: 'var(--space-3)' }}>
      <Field
        id={id}
        label={`Questions (${count} of ${MAX_PROMPTS})`}
        hint={{
          about: 'how questions are checked',
          body: `Each question is put to the AI engines once a day. A citation is only reported once it holds across at least three checks on three different days, because about 45% of citations show up in just one check out of three. The limit of ${MAX_PROMPTS} is there because every question is a paid check, every day.`,
        }}
        help={
          <>
            One per line, the way somebody would type it into ChatGPT: &ldquo;how much does a Kenyan
            safari cost&rdquo;, not &ldquo;safari kenya price&rdquo;.
          </>
        }
      >
        <textarea
          id={id}
          className="input"
          rows={7}
          value={prompts}
          onChange={(event) => setPrompts(event.target.value)}
          placeholder={'how much does a kenyan safari cost\nbest safari operator in nairobi'}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>

      {tooMany && (
        <div role="alert" className="note note-warn">
          {count} questions is over the limit of {MAX_PROMPTS}. Remove {count - MAX_PROMPTS} to
          save.
        </div>
      )}
      <ErrorNote error={error} />
      {saved && !error && <SavedNote>{saved}</SavedNote>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={pending || tooMany}
        >
          {pending ? 'Saving...' : 'Save questions'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Close
        </button>
      </div>
    </div>
  )
}
