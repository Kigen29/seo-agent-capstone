/**
 * Feedback after the Google OAuth round trip.
 *
 * States that must read differently, because "not connected" and "just failed" and "you
 * declined" are three different things and lumping them under one grey message is the kind
 * of vagueness this product is meant to avoid.
 */
/** The exact set of statuses the OAuth callback redirects with. See the API's backToDashboard. */
type GoogleCallbackStatus = 'connected' | 'declined' | 'invalid' | 'unavailable' | 'failed'

const CALLBACK_MESSAGE: Record<
  GoogleCallbackStatus,
  { tone: 'ok' | 'warn' | 'error'; text: string }
> = {
  connected: { tone: 'ok', text: 'Search Console connected.' },
  declined: { tone: 'warn', text: 'Consent was declined. Nothing was connected.' },
  invalid: {
    tone: 'error',
    text: 'That sign-in link had expired or did not check out. Try again.',
  },
  unavailable: { tone: 'warn', text: 'Search Console is not configured on this server yet.' },
  failed: { tone: 'error', text: 'Something went wrong connecting Google. Try again shortly.' },
}

/** The callback value is an untrusted query string, so narrow it to a known status before use. */
const isCallbackStatus = (value: string): value is GoogleCallbackStatus => value in CALLBACK_MESSAGE

const TONE: Record<'ok' | 'warn' | 'error', string> = {
  ok: 'note note-ok',
  warn: 'note note-warn',
  error: 'note note-error',
}

/**
 * Only the outcome message after the Google OAuth round trip. The connection's state and its
 * button now live on the dashboard's setup checklist; this keeps the "connected", "declined" and
 * "failed" feedback where the redirect lands.
 */
export function GoogleCallbackNote({ callback }: { callback?: string }) {
  const message = callback && isCallbackStatus(callback) ? CALLBACK_MESSAGE[callback] : undefined
  if (!message) return null
  return (
    <p role="status" className={TONE[message.tone]} style={{ marginTop: 'var(--space-4)' }}>
      {message.text}
    </p>
  )
}
