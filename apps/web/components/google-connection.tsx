import { OutcomeNote, outcomeFor, type Outcome } from './ui/outcome-note'

/**
 * Feedback after the Google OAuth round trip.
 *
 * States that must read differently, because "not connected" and "just failed" and "you
 * declined" are three different things and lumping them under one grey message is the kind
 * of vagueness this product is meant to avoid.
 */
/** The statuses the OAuth callback redirects with. See the API's backToDashboard. */

const CALLBACK: Record<string, Outcome> = {
  connected: {
    tone: 'ok',
    title: 'Search Console is connected',
    detail: 'Your real searches and clicks will be read on the next audit.',
  },
  declined: {
    tone: 'info',
    title: 'Nothing was connected',
    detail: 'Consent was declined on Google. You can connect whenever you are ready.',
  },
  invalid: {
    tone: 'warn',
    title: 'That link had expired',
    detail: 'It is good for a few minutes and for one use. Start the connection again from here.',
  },
  unavailable: {
    tone: 'info',
    title: 'Search Console is not switched on here',
    detail: 'Connecting Google has not been set up on this installation yet.',
  },
  failed: {
    tone: 'error',
    title: 'We could not finish connecting Google',
    detail: 'That is a fault on our side, not something you did. Try again in a moment.',
  },
}

export function GoogleCallbackNote({ callback }: { callback?: string }) {
  return <OutcomeNote outcome={outcomeFor(CALLBACK, callback)} className="mt-4" />
}
