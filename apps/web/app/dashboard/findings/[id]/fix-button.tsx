import { SubmitButton } from '@/components/ui/submit-button'
import { openFixPr } from './actions'

/**
 * The button that opens the pull request.
 *
 * It was a bare `<form action={...}>` with a plain submit button and no pending state, which made
 * it the only interactive control in the app with no feedback: every other form swaps its label
 * while the action runs. That is backwards. This is the single most consequential click in the
 * product, it triggers a server action that talks to GitHub and can take seconds, and a user who
 * gets no acknowledgement clicks it again, which is exactly the input the idempotency guard in
 * ADR-0012 exists to survive rather than an input we should be provoking.
 */
export function FixButton({ findingId }: { findingId: string }) {
  return (
    <form action={openFixPr}>
      <input type="hidden" name="findingId" value={findingId} />
      <SubmitButton pendingLabel="Opening the pull request...">Open a pull request</SubmitButton>
    </form>
  )
}
