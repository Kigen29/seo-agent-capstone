import type { OutreachDraft } from '@seo/api-client'
import { ErrorNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import { OutboundLink } from '@/components/ui/outbound-link'
import type { UserError } from '@/lib/user-error'

/**
 * The draft, once written: editable, and with two ways to take it away.
 *
 * There is no Send here and there will not be one. The draft is copied, or opened in the
 * person's own mail program, and they send it themselves. What the draft was allowed to say is
 * listed under it, so a claim that is not on the list can be seen for what it is.
 */
export function DraftEditor({
  id,
  result,
  subject,
  body,
  onSubject,
  onBody,
  error,
  copied,
  onCopy,
  onChangeFact,
}: {
  /** The composer's id, so the fields here are labelled within the same form. */
  id: string
  result: OutreachDraft
  subject: string
  body: string
  onSubject: (subject: string) => void
  onBody: (body: string) => void
  error: UserError | null
  copied: boolean
  onCopy: () => void
  onChangeFact: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* From the payload, not from this file, so the caveat cannot be dropped by a redesign. */}
      <div className="note note-info">
        {result.sendPolicy}. Edit it here, then send it yourself from your own mail. Nothing on this
        page can send it for you.
      </div>

      <Field id={`${id}-subject`} label="Subject">
        <input
          id={`${id}-subject`}
          className="input"
          value={subject}
          onChange={(event) => onSubject(event.target.value)}
        />
      </Field>

      <Field id={`${id}-body`} label="Email">
        <textarea
          id={`${id}-body`}
          className="input"
          rows={12}
          value={body}
          onChange={(event) => onBody(event.target.value)}
          style={{ resize: 'vertical', lineHeight: 1.6 }}
        />
      </Field>

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy email'}
        </button>
        <a
          className="btn btn-secondary"
          href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
        >
          Open in my mail app
        </a>
        <button type="button" className="btn btn-ghost" onClick={onChangeFact}>
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
                {entry.claim} <OutboundLink href={entry.sourceUrl}>check it</OutboundLink>
              </li>
            ))}
          </ul>
          <div className="text-muted">
            The draft was allowed to use these facts and no others. If it states something that is
            not on this list, that is a fault worth reporting.
          </div>
        </div>
      </details>
    </div>
  )
}
