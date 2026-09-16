'use client'

import type { AuditProgress } from '@seo/api-client'

import { fetchAuditProgress } from '@/app/(app)/audits/[id]/progress-action'
import { usePolledProgress } from '@/components/use-polled-progress'

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
 *
 * The polling itself lives in `usePolledProgress`, because the fix flow needed the same behaviour
 * and copying it would have meant two timers to keep in step. No give-up here: a crawl that has
 * started will end, so there is nothing to give up on.
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
  /*
    `enabled` reads the prop, not the polled value, and the two differ in a way that matters.

    The hook stops itself the moment a poll comes back finished, so this only has to answer "was
    it running when the page rendered". Deriving it from the polled value instead would mean an
    audit that was already complete on load starts a poll, learns it is finished, and refreshes
    the page, which re-renders this component, which polls again.
  */
  const { latest } = usePolledProgress<AuditProgress>({
    enabled: RUNNING.has(status),
    poll: () => fetchAuditProgress(auditId),
    intervalMs: INTERVAL_MS,
  })

  // The last thing we heard, falling back to what the server rendered with before the first poll.
  const live = latest ?? { status, pagesCrawled }
  if (!RUNNING.has(live.status)) return null

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
