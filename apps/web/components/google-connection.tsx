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
  ok: 'border-emerald-900 bg-emerald-950/40 text-emerald-300',
  warn: 'border-amber-900 bg-amber-950/40 text-amber-300',
  error: 'border-red-900 bg-red-950/40 text-red-300',
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
    <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-neutral-200">Google Search Console</p>
          <p className="mt-1 text-sm text-neutral-500">
            {connection.connected
              ? `Connected as ${connection.email ?? 'your Google account'}. Real query and click data can now feed your audits.`
              : 'Connect to pull real search queries, clicks, and impressions. We use OAuth and never see your password.'}
          </p>
        </div>

        <form action={connectGoogle}>
          <button
            type="submit"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:text-white"
          >
            {connection.connected ? 'Reconnect' : 'Connect Search Console'}
          </button>
        </form>
      </div>

      {message && (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${TONE[message.tone]}`}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
