'use client'

import { useEffect } from 'react'

/**
 * The error boundary. There was none, so any status `handleApiError` did not recognise reached
 * Next's raw error screen: white background, monospace stack, no navigation, nothing of the
 * product left on the page. That is the worst possible moment to stop looking like yourself.
 *
 * It says what is known and no more. `digest` is the only handle a user has on a server error,
 * because the message itself is deliberately withheld from the client in production, so it is
 * shown rather than swallowed: it is what turns "it broke" into something we can find in a log.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('rankwright: unhandled error', error)
  }, [error])

  return (
    <main id="main" className="wrap">
      <div className="card elev-sm" style={{ maxWidth: 620 }}>
        <div className="card-kicker">Something broke</div>
        <h3 style={{ margin: '0 0 var(--space-3)' }}>That did not work</h3>

        <p style={{ fontSize: 14 }}>
          The page failed to load, and the failure was not one we recognise. Nothing you did caused
          it and no data has been lost. Trying again is worthwhile: most of these are transient.
        </p>

        {error.digest && (
          <p className="text-muted" style={{ fontSize: 13 }}>
            Reference{' '}
            <code className="mono" style={{ padding: '1px 6px' }}>
              {error.digest}
            </code>
            , if you report it.
          </p>
        )}

        <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <a href="/dashboard" className="btn btn-secondary">
            Back to your sites
          </a>
        </div>
      </div>
    </main>
  )
}
