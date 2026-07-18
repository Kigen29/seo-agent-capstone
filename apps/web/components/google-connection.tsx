import { connectGoogle } from '@/app/dashboard/actions'

/**
 * The Search Console connection panel.
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

export function GoogleConnection({
  connection,
  callback,
}: {
  connection: { connected: boolean; email?: string | null }
  callback?: string
}) {
  const message = callback && isCallbackStatus(callback) ? CALLBACK_MESSAGE[callback] : undefined

  return (
    <section
      className="card elev-sm"
      style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)' }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>Google Search Console</p>
          <p style={{ margin: '5px 0 0', fontSize: 14, opacity: 0.75, maxWidth: '60ch' }}>
            {connection.connected
              ? `Connected as ${connection.email ?? 'your Google account'}. Real query and click data can now feed your audits.`
              : 'Connect to pull real search queries, clicks, and impressions. We use OAuth and never see your password.'}
          </p>
        </div>

        <form action={connectGoogle}>
          <button type="submit" className="btn btn-secondary">
            {connection.connected ? 'Reconnect' : 'Connect Search Console'}
          </button>
        </form>
      </div>

      {message && (
        <p role="status" className={TONE[message.tone]} style={{ marginTop: 'var(--space-3)' }}>
          {message.text}
        </p>
      )}
    </section>
  )
}
