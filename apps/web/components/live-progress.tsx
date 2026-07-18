'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Live progress, not a spinner. The story asks for this by name.
 *
 * A spinner tells the user nothing: it spins identically for a crawl racing through two
 * hundred pages and for one that died four minutes ago. A moving page count tells them the
 * thing is alive, roughly how far along it is, and lets them decide whether to wait. That is
 * the difference between waiting and closing the tab.
 *
 * Polling rather than a socket. The count already lives on the audit row, so a poll is one
 * cheap indexed read, and it survives the API sleeping and waking underneath it, which a
 * long-lived connection on a free instance would not. Server-sent events would be nicer and
 * would need a connection held open on a service that spins down: the wrong trade for this
 * stack.
 *
 * Stops when the audit stops. A poll that runs forever against a finished audit is a
 * background tab quietly burning somebody's battery.
 */
export function LiveProgress({ status, pagesCrawled }: { status: string; pagesCrawled: number }) {
  const router = useRouter()
  const running = status === 'queued' || status === 'crawling' || status === 'evaluating'

  useEffect(() => {
    if (!running) return

    const id = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(id)
  }, [running, router])

  if (!running) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="card elev-sm"
      style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        <p style={{ margin: 0, fontSize: 14 }}>
          {status === 'evaluating' ? 'Running the rules' : 'Crawling'}
        </p>
        <p className="tnum" style={{ margin: 0, fontSize: 14, color: 'var(--color-accent-700)' }}>
          {pagesCrawled} {pagesCrawled === 1 ? 'page' : 'pages'}
        </p>
      </div>

      <p style={{ margin: '9px 0 0', fontSize: 12, opacity: 0.6 }}>
        We crawl slowly, one request at a time per host, because we are a guest on someone
        else&apos;s origin. This updates as it goes.
      </p>
    </div>
  )
}
