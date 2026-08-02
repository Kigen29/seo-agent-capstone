'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { fetchAuditProgress } from '@/app/(app)/audits/[id]/progress-action'

/**
 * Live progress, not a spinner. The story asks for this by name.
 *
 * A spinner tells the user nothing: it spins identically for a crawl racing through two hundred
 * pages and for one that died four minutes ago. A moving page count tells them the thing is alive,
 * roughly how far along it is, and lets them decide whether to wait. That is the difference
 * between waiting and closing the tab.
 *
 * Polling rather than a socket. It survives the API sleeping and waking underneath it, which a
 * long-lived connection on a free instance would not. Server-sent events would be nicer and would
 * need a connection held open on a service that spins down: the wrong trade for this stack.
 *
 * What changed is *what* it polls. It used to call `router.refresh()`, which re-renders the whole
 * server component, which calls `getAudit`, which returns every finding with its full evidence,
 * baseline and verification JSON. On a large crawl that is megabytes re-serialised every two
 * seconds to read two numbers. Now it polls a four-field endpoint and updates its own count, and
 * refreshes the page exactly once, when the audit finishes and there is genuinely new content to
 * show.
 *
 * Stops when the audit stops. A poll that runs forever against a finished audit is a background
 * tab quietly burning somebody's battery.
 */
const RUNNING = new Set(['queued', 'crawling', 'evaluating'])
const INTERVAL_MS = 2000

export function LiveProgress({
  auditId,
  status,
  pagesCrawled,
}: {
  auditId: string
  status: string
  pagesCrawled: number
}) {
  const router = useRouter()
  const [live, setLive] = useState({ status, pagesCrawled })
  const running = RUNNING.has(live.status)

  useEffect(() => {
    if (!running) return

    let cancelled = false

    const id = setInterval(async () => {
      const progress = await fetchAuditProgress(auditId)
      if (cancelled || !progress) return

      setLive({ status: progress.status, pagesCrawled: progress.pagesCrawled })

      // One refresh, at the end, to pull in the scorecard and the findings the crawl produced.
      if (progress.finished) router.refresh()
    }, INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [running, auditId, router])

  if (!running) return null

  return (
    <div role="status" aria-live="polite" className="card elev-sm mt-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="m-0 text-sm">
          {live.status === 'evaluating' ? 'Running the rules' : 'Crawling'}
        </p>
        <p className="tnum m-0 text-sm" style={{ color: 'var(--color-accent-700)' }}>
          {live.pagesCrawled} {live.pagesCrawled === 1 ? 'page' : 'pages'}
        </p>
      </div>

      <p className="text-muted m-0 text-xs">
        We crawl slowly, one request at a time per host, because we are a guest on someone
        else&apos;s origin. This updates as it goes.
      </p>
    </div>
  )
}
