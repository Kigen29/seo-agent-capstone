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
      className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950 p-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-neutral-300">
          {status === 'evaluating' ? 'Running the rules' : 'Crawling'}
        </p>
        <p className="font-mono text-sm tabular-nums text-neutral-400">
          {pagesCrawled} {pagesCrawled === 1 ? 'page' : 'pages'}
        </p>
      </div>

      <p className="mt-2 text-xs text-neutral-600">
        We crawl slowly, one request at a time per host, because we are a guest on someone
        else&apos;s origin. This updates as it goes.
      </p>
    </div>
  )
}
