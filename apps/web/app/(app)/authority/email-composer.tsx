'use client'

import type { OutreachDraft } from '@seo/api-client'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import { invalid, type UserError } from '@/lib/user-error'
import { draftOutreach } from './outreach-action'

/**
 * One place to write an email, for whichever publication was picked.
 *
 * There used to be a form folded under every row of every list. Forty publications meant forty
 * copies of the same three fields, a draft that appeared in the middle of a list and pushed the
 * rest down the page, and a fact that had to be typed again for each one. This is a single panel
 * that opens over the page, in two steps: say the one fact, then read and edit the draft.
 *
 * The fact is remembered between publications, because it is the same business and usually the
 * same fact; only the email around it changes.
 *
 * It still cannot send. The draft lands in two editable fields with a copy button and a link that
 * opens the person's own mail program with the text in it. Pressing send is theirs to do, from
 * their own address (CLAUDE.md rule 6). The caveat above the draft is rendered from the payload's
 * own `sendPolicy`, so a redesign of this panel cannot drop it.
 *
 * A native `<dialog>`: focus is trapped, Escape closes it and the page behind is inert, without a
 * library.
 */
export interface Fact {
  claim: string
  sourceUrl: string
}

export function EmailComposer({
  siteId,
  domain,
  fact,
  onFact,
  onDrafted,
  onClose,
}: {
  siteId: string
  /** The publication being written to, or null when the panel is closed. */
  domain: string | null
  fact: Fact
  onFact: (fact: Fact) => void
  onDrafted: (domain: string) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (domain && !element.open) element.showModal()
    if (!domain && element.open) element.close()
  }, [domain])

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-labelledby="composer-title">
      {domain && (
        // Keyed by publication, so a draft for one can never be shown under another's name.
        <Composer
          key={domain}
          siteId={siteId}
          domain={domain}
          fact={fact}
          onFact={onFact}
          onDrafted={onDrafted}
          onClose={() => dialog.current?.close()}
        />
      )}
    </dialog>
  )
}

function Composer({
  siteId,
  domain,
  fact,
  onFact,
  onDrafted,
  onClose,
}: {
  siteId: string
  domain: string
  fact: Fact
  onFact: (fact: Fact) => void
  onDrafted: (domain: string) => void
  onClose: () => void
}) {
  const id = useId()
  const [claim, setClaim] = useState(fact.claim)
  const [sourceUrl, setSourceUrl] = useState(fact.sourceUrl)
  const [context, setContext] = useState('')
  const [result, setResult] = useState<OutreachDraft | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [declined, setDeclined] = useState(false)
  const [error, setError] = useState<UserError | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()

  function write(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setDeclined(false)

    if (!claim.trim() || !sourceUrl.trim()) {
      setError(
        invalid(
          'Two things are needed first',
          'The fact, and a page where an editor can check it. Without both this would be a template, and a template is what every other outreach tool already sends.',
        ),
      )
      return
    }

    onFact({ claim: claim.trim(), sourceUrl: sourceUrl.trim() })
    start(async () => {
      const answer = await draftOutreach(siteId, { domain, claim, sourceUrl, context })
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      if (!answer.data) {
        setDeclined(true)
        return
      }
      setResult(answer.data)
      setSubject(answer.data.draft.subject)
      setBody(answer.data.draft.body)
      onDrafted(domain)
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(
        invalid(
          'Your browser did not allow copying',
          'Select the text in the two boxes and copy it by hand.',
        ),
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="card-kicker">
            {result ? 'Step 2 of 2: your draft' : 'Step 1 of 2: your fact'}
          </div>
          <h2 id="composer-title" className="h-section m-0 break-all" style={{ fontSize: 22 }}>
            Email to {domain}
          </h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose}>
          <X size={16} aria-hidden="true" />
          <span className="sr-only">Close</span>
        </button>
      </div>

      {!result && (
        <form onSubmit={write} className="flex flex-col gap-4">
          <Field
            id={`${id}-claim`}
            label="The one fact only you have"
            hint={{
              about: 'what makes a good fact',
              body: 'A number, a date, a method or a dataset that is true and that nobody else can claim. Not an adjective: "the best guides" is an opinion, "every guide has led 200 or more trips" is a fact. An editor decides in seconds, and a specific fact is what gets a reply.',
            }}
            help="This is the only part we cannot write for you. It is kept for your next email."
          >
            <textarea
              id={`${id}-claim`}
              className="input"
              rows={3}
              maxLength={500}
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
              placeholder="We have published vehicle occupancy for every 9-day Mara circuit since 2011."
              style={{ resize: 'vertical' }}
            />
          </Field>

          <Field
            id={`${id}-source`}
            label="Where an editor can check it"
            help="A public page that shows the fact."
          >
            <input
              id={`${id}-source`}
              className="input"
              type="url"
              maxLength={2000}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com/about/fleet"
            />
          </Field>

          <Field
            id={`${id}-context`}
            label="Something they published recently (optional)"
            help="Makes the opening line about them, not about you."
          >
            <input
              id={`${id}-context`}
              className="input"
              maxLength={500}
              value={context}
              onChange={(event) => setContext(event.target.value)}
            />
          </Field>

          {declined && (
            <div role="status" className="note note-warn">
              <div className="font-semibold">No draft was written</div>
              <div className="mt-0.5">
                The fact was not specific enough to pitch this publication. Try one with a number or
                a date in it. That is a better answer than a generic email under your name.
              </div>
            </div>
          )}
          <ErrorNote error={error} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Writing the draft...' : 'Write the draft'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {/* From the payload, not from this file, so the caveat cannot be dropped by a redesign. */}
          <div className="note note-info">
            {result.sendPolicy}. Edit it here, then send it yourself from your own mail. Nothing on
            this page can send it for you.
          </div>

          <Field id={`${id}-subject`} label="Subject">
            <input
              id={`${id}-subject`}
              className="input"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>

          <Field id={`${id}-body`} label="Email">
            <textarea
              id={`${id}-body`}
              className="input"
              rows={12}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              style={{ resize: 'vertical', lineHeight: 1.6 }}
            />
          </Field>

          <ErrorNote error={error} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy email'}
            </button>
            <a
              className="btn btn-secondary"
              href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
            >
              Open in my mail app
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setResult(null)
                setError(null)
              }}
            >
              Change the fact
            </button>
          </div>

          <details>
            <summary className="cursor-pointer text-[13px]">
              Why this publication, and what the draft is built on
            </summary>
            <div className="mt-2 flex flex-col gap-2 text-[13px]">
              <div className="text-muted">{result.draft.angle}</div>
              <ul className="m-0 pl-4">
                {result.groundedOn.map((entry) => (
                  <li key={entry.sourceUrl}>
                    {entry.claim}{' '}
                    <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                      check it
                    </a>
                  </li>
                ))}
              </ul>
              <div className="text-muted">
                The draft was allowed to use these facts and no others. If it states something that
                is not on this list, that is a fault worth reporting.
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
