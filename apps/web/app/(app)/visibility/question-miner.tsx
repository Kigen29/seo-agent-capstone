'use client'

import type { MinedQuestion } from '@seo/api-client'
import { useState, useTransition } from 'react'
import { addPrompts, mineQuestions } from './actions'

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
 * Selected questions are appended to the tracked prompts, never substituted for them: prompts
 * already being polled carry a poll history, and replacing the list would throw away windows a
 * user has waited days for.
 */
export function QuestionMiner({ siteId }: { siteId: string }) {
  const [pending, start] = useTransition()
  const [seed, setSeed] = useState('')
  const [questions, setQuestions] = useState<MinedQuestion[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function find() {
    setError(null)
    setSaved(null)
    start(async () => {
      const result = await mineQuestions(siteId, seed.trim())
      if ('error' in result) {
        setError(result.error)
        return
      }
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
      const result = await addPrompts(siteId, [...chosen])
      if ('error' in result) {
        setError(result.error)
        return
      }
      setChosen(new Set())
      setSaved(
        `Now tracking ${result.prompts.length} question(s). Polling runs once a day, and the ` +
          'first verdict lands after three days.',
      )
    })
  }

  return (
    <section className="mt-8">
      <h2 className="h-section mb-1">Questions your customers actually ask</h2>
      <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
        From your own Search Console, which is free and knows what you are already shown for. Add a
        subject to also ask Google what it suggests alongside it, which is one billed query.
      </p>

      <div className="card elev-sm gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="card-kicker">Subject (optional)</span>
            <input
              className="input"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="floor tiles nairobi"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <button
            type="button"
            className="btn btn-primary shrink-0"
            onClick={find}
            disabled={pending}
          >
            {pending ? 'Looking…' : 'Find questions'}
          </button>
        </div>

        <p className="text-muted m-0 text-[13px]">
          Leave the subject blank to use Search Console alone, which costs nothing.
        </p>
      </div>

      {error && (
        <p className="mt-3 text-[13px]" role="alert" style={{ color: 'var(--color-neutral-800)' }}>
          {error}
        </p>
      )}

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
                    {entry.source === 'search-console' ? (
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
            {saved && <span className="text-muted text-[13px]">{saved}</span>}
          </div>
        </>
      )}
    </section>
  )
}
