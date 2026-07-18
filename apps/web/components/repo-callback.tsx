/**
 * The banner shown after the GitHub App install flow redirects back to the dashboard.
 *
 * Repositories connect per site, not from one panel, so this is a top-level status line rather
 * than a connection card: it says what just happened, and the per-site rows show what is now
 * connected. Each outcome reads differently, for the same reason the Google banner does:
 * "declined", "expired link", and "failed" are not the same event.
 */

/** The exact set of statuses the GitHub setup callback redirects with. See backToDashboardGithub. */
type RepoCallbackStatus = 'connected' | 'declined' | 'invalid' | 'unavailable' | 'failed' | 'norepo'

const CALLBACK_MESSAGE: Record<
  RepoCallbackStatus,
  { tone: 'ok' | 'warn' | 'error'; text: string }
> = {
  connected: {
    tone: 'ok',
    text: 'Repository connected. The agent can now open pull requests on it.',
  },
  declined: { tone: 'warn', text: 'The install was cancelled. Nothing was connected.' },
  invalid: {
    tone: 'error',
    text: 'That install link had expired or did not check out. Try again.',
  },
  unavailable: { tone: 'warn', text: 'The GitHub App is not configured on this server yet.' },
  failed: {
    tone: 'error',
    text: 'Something went wrong connecting the repository. Try again shortly.',
  },
  norepo: {
    tone: 'warn',
    text: 'No repository was granted during the install. Reconnect and select a repo.',
  },
}

const isCallbackStatus = (value: string): value is RepoCallbackStatus => value in CALLBACK_MESSAGE

const TONE: Record<'ok' | 'warn' | 'error', string> = {
  ok: 'border-emerald-900 bg-emerald-950/40 text-emerald-300',
  warn: 'border-amber-900 bg-amber-950/40 text-amber-300',
  error: 'border-red-900 bg-red-950/40 text-red-300',
}

export function RepoCallback({ callback }: { callback?: string }) {
  const message = callback && isCallbackStatus(callback) ? CALLBACK_MESSAGE[callback] : undefined
  if (!message) return null

  return (
    <p role="status" className={`mt-4 rounded-md border px-3 py-2 text-sm ${TONE[message.tone]}`}>
      {message.text}
    </p>
  )
}
