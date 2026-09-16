'use client'

import { useActionState } from 'react'
import { Note } from '@/components/ui/note'
import { SubmitButton } from '@/components/ui/submit-button'
import { draftOutreachAction, type OutreachState } from './outreach-action'

/**
 * Draft a pitch to one publication that already wrote about this client and did not link.
 *
 * This is the whole product argument in one control. The list above it is the cheapest link work
 * available, and the reason it usually goes undone is that writing twelve individual emails is a
 * morning nobody has. So the agent writes them, one at a time, and a person sends them.
 *
 * Two things it deliberately does not do.
 *
 * It does not send, and it cannot. There is no transport in this component, in the action it
 * calls, in the route that serves it, or in the drafter underneath (CLAUDE.md rule 6). The
 * caveat on the result is rendered from the payload's own `sendPolicy` rather than hard-coded
 * here, so a screen cannot show a draft without it.
 *
 * It does not invent the fact. The field is required and the drafter refuses without it, because
 * a pitch with no specific fact is a template, and a template spends the client's name for
 * nothing. Asking the client for the one thing only they know is the honest version of this
 * feature; guessing it would be the expensive one.
 *
 * A `<details>` rather than a modal: twelve of these can sit in a list, only one is usually open,
 * and it costs no JavaScript to disclose. The form works without JavaScript too; what needs it
 * is showing the draft in place rather than on a reloaded page.
 */
const INITIAL: OutreachState = { status: 'idle' }

export function OutreachPitch({ siteId, domain }: { siteId: string; domain: string }) {
  const [state, formAction] = useActionState(draftOutreachAction, INITIAL)

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] select-none">Draft an email</summary>

      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="siteId" value={siteId} />
        <input type="hidden" name="domain" value={domain} />

        <label className="flex flex-col gap-1 text-[13px]">
          The one specific, true thing nobody else has
          <textarea
            name="claim"
            required
            maxLength={500}
            rows={3}
            className="input"
            placeholder="We have published vehicle occupancy for every 9-day Mara circuit since 2011."
          />
          <span className="text-muted text-xs">
            Not an adjective. A number, a date, a method, or a dataset. This is the only part of the
            email we cannot write for you, and it is the part that decides whether it works.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-[13px]">
          Where an editor can check it
          <input
            name="sourceUrl"
            type="url"
            required
            maxLength={2000}
            className="input"
            placeholder="https://example.com/about/fleet"
          />
        </label>

        <label className="flex flex-col gap-1 text-[13px]">
          What they recently published, if you know it (optional)
          <input name="context" type="text" maxLength={500} className="input" />
        </label>

        <div>
          <SubmitButton pendingLabel="Writing the draft...">Draft it</SubmitButton>
        </div>
      </form>

      {state.status === 'none' && (
        <Note tone="warn" className="mt-3">
          {state.message}
        </Note>
      )}

      {state.status === 'error' && (
        <Note tone="error" className="mt-3">
          {state.message}
        </Note>
      )}

      {state.status === 'drafted' && (
        <div className="mt-3">
          {/* From the payload, not from this file, so the caveat cannot be dropped by a redesign. */}
          <Note tone="info" className="mb-3">
            {state.result.sendPolicy}. Read it, change what you want, and send it yourself from your
            own mail client. Nothing here can send it for you.
          </Note>

          <div className="card elev-sm">
            <div className="card-kicker">Subject</div>
            <p className="m-0 text-sm">{state.result.draft.subject}</p>

            <div className="card-kicker mt-3">Body</div>
            <p className="m-0 text-sm whitespace-pre-wrap">{state.result.draft.body}</p>

            <div className="card-kicker mt-3">Why this publication</div>
            <p className="text-muted m-0 text-[13px]">{state.result.draft.angle}</p>

            <div className="card-kicker mt-3">Built only on</div>
            <ul className="m-0 pl-4 text-[13px]">
              {state.result.groundedOn.map((fact) => (
                <li key={fact.sourceUrl}>
                  {fact.claim}{' '}
                  <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
                    check it
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-muted m-0 text-xs">
              The model was given these and forbidden from adding to them. If the draft contains a
              fact that is not on this list, that is a bug worth reporting, and it is the reason
              this list is here rather than only in the prompt.
            </p>
          </div>
        </div>
      )}
    </details>
  )
}
