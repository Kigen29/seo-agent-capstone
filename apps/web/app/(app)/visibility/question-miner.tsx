'use client'

import type { MinedQuestion } from '@seo/api-client'
import { useState, useTransition } from 'react'
import { ErrorNote, SavedNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { addPrompts, mineQuestions, suggestPrompts } from './actions'

/** One row in the list: a mined question, or one the agent drafted with its reason. */
type Candidate =
  MinedQuestion | { question: string; source: 'agent'; reason: string; variants: string[] }

/**
 * Questions a site's customers actually ask, and a way to start tracking them.
 *
 * This exists because of a gap the product had been carrying: the AI-visibility axis is the only
 * one that cannot infer its own inputs, so every tracked prompt was typed by hand from memory. A
 * person staring at an empty textarea writes three questions and stops. Their Search Console
 * already knows dozens.
 *
 * Two sources, labelled rather than blended, because they are not equally strong. A Search Console
 * question is demand this site already receives, with impressions and a position attached. A
 * People Also Ask question is demand Google has seen somewhere, which is worth knowing and is not
 * the same claim. The badge says which, every row.
 *
 * The first option asks for nothing at all: the agent drafts questions from what the site says
 * about itself and its latest audit, and the person only ticks the ones worth tracking.
 *
 * Selected questions are appended to the tracked prompts, never substituted for them: prompts
 * already being polled carry a poll history, and replacing the list would throw away windows a
 * user has waited days for.
 */
export function QuestionMiner({ siteId }: { siteId: string }) {
  const [pending, start] = useTransition()
  const [seed, setSeed] = useState('')
  const [questions, setQuestions] = useState<Candidate[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<UserError | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function draft() {
    setError(null)
    setSaved(null)
    start(async () => {
      const answer = await suggestPrompts(siteId)
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      const result = answer.data
      setQuestions(
        result.suggestions.map((entry) => ({
          question: entry.prompt,
          source: 'agent' as const,
          reason: entry.reason,
          variants: [],
        })),
      )
      setNote(result.note ?? null)
      // Drafted for this site, so all start ticked: untick what does not fit, then save.
      setChosen(new Set(result.suggestions.map((entry) => entry.prompt)))
    })
  }

  function find() {
    setError(null)
    setSaved(null)
    start(async () => {
      const answer = await mineQuestions(siteId, seed.trim())
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      const result = answer.data
      setQuestions(result.questions)
      setNote(result.note ?? null)
      setChosen(new Set())
    })
  }

  function toggle(question: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(question)) next.delete(question)
      else next.add(question)
      return next
    })
  }

  function track() {
    setError(null)
    setSaved(null)
    start(async () => {
      const answer = await addPrompts(siteId, [...chosen])
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      const result = answer.data
      setChosen(new Set())
      setSaved(
        `Now tracking ${result.prompts.length} ${result.prompts.length === 1 ? 'question' : 'questions'}. ` +
          'Each is asked once a day, and the first verdict arrives after three days.',
      )
    })
  }

  return (
    <section id="questions" className="mt-8 scroll-mt-6">
      <h2 className="h-section mb-1">Which questions should we track?</h2>
      <div className="text-muted mb-3 max-w-[68ch] text-sm">
        We ask AI assistants the questions your customers would, and report whether your site is
        mentioned in the answer. Start with the suggestions, then keep the ones that fit.
      </div>

      <div className="card elev-sm mb-3 flex flex-wrap items-center gap-3 p-4">
        <button type="button" className="btn btn-primary" onClick={draft} disabled={pending}>
          {pending ? 'Working…' : 'Suggest questions for me'}
        </button>
        <span className="text-muted text-[13px]">
          Drafted from your homepage and latest audit. Uses a little of your monthly allowance.
        </span>
      </div>

      <div className="text-muted mb-2 text-[13px]">Or find the questions people already ask:</div>
      <div className="card elev-sm gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="card-kicker">Subject (optional)</span>
            <input
              className="input"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="for example, running shoes"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <button
            type="button"
            className="btn btn-secondary shrink-0"
            onClick={find}
            disabled={pending}
          >
            {pending ? 'Looking…' : 'Find questions'}
          </button>
        </div>

        <div className="text-muted text-[13px]">
          Leave the subject blank to use your Search Console data alone, which is free. With a
          subject, we also look up the related questions Google shows.
        </div>
      </div>

      <ErrorNote error={error} className="mt-3" />

      {note && <p className="text-muted mt-3 mb-0 text-[13px]">{note}</p>}

      {questions && questions.length === 0 && !note && (
        <p className="text-muted mt-3 mb-0 text-[13px]">
          Nothing came back. With Search Console connected this usually means the site draws no
          question-shaped searches yet, which is itself worth knowing.
        </p>
      )}

      {questions && questions.length > 0 && (
        <>
          <div className="card elev-sm mt-3 gap-0 p-0">
            {questions.map((entry, index) => (
              <label
                key={entry.question}
                className="flex cursor-pointer items-start gap-3 p-3"
                style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(entry.question)}
                  onChange={() => toggle(entry.question)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{entry.question}</span>
                  <span className="text-muted mt-1 block text-[12px]">
                    {entry.source === 'agent' ? (
                      <>Suggested by the agent · {entry.reason}</>
                    ) : entry.source === 'search-console' ? (
                      <>
                        Search Console
                        {entry.impressions === undefined
                          ? ''
                          : ` · ${entry.impressions.toLocaleString('en-US')} impressions`}
                        {entry.position === undefined
                          ? ''
                          : ` · position ${entry.position.toFixed(1)}`}
                      </>
                    ) : (
                      'People Also Ask'
                    )}
                    {entry.variants.length > 0 &&
                      ` · also asked ${entry.variants.length} other way${
                        entry.variants.length === 1 ? '' : 's'
                      }`}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={track}
              disabled={pending || chosen.size === 0}
            >
              {pending
                ? 'Saving…'
                : `Track ${chosen.size || ''} question${chosen.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}

      {saved && <SavedNote className="mt-3">{saved}</SavedNote>}
    </section>
  )
}
