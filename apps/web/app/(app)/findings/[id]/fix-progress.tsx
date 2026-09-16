'use client'

import type { FixProgress as FixProgressPayload } from '@seo/api-client'
import { usePolledProgress } from '@/components/use-polled-progress'
import { fetchFixProgress } from './fix-progress-action'

/**
 * What happens after "Open a pull request" is clicked.
 *
 * This was the one consequential action in the product with no feedback. You clicked, a banner
 * said a pull request was on its way, and then nothing changed until you reloaded by hand. The
 * work runs on a GitHub Actions worker, so the wait is real, and a user with no signal assumes it
 * failed and clicks again.
 *
 * It says what is actually true at each moment rather than showing a spinner. A spinner implies
 * something is underway; until a runner claims the job, nothing is, and pretending otherwise is
 * the dishonest version of this component. So the first line is "queued", not "working".
 *
 * It also stops. `repository_dispatch` fires on enqueue and a runner usually starts within a
 * minute or two, but that is a normal case rather than a guarantee: if the dispatch is not
 * configured the job waits for the schedule, which is measured in hours on this stack (see
 * docs/state-of-play.md). Polling for hours would be pointless, so after a few minutes it says so
 * and hands the user something true to do instead, which is to come back and reload.
 */
const POLL_MS = 2000
const MAX_POLL_MS = 10_000
const GIVE_UP_MS = 5 * 60_000

export function FixProgress({ findingId }: { findingId: string }) {
  const { latest, gaveUp } = usePolledProgress<FixProgressPayload>({
    enabled: true,
    poll: () => fetchFixProgress(findingId),
    intervalMs: POLL_MS,
    maxIntervalMs: MAX_POLL_MS,
    giveUpAfterMs: GIVE_UP_MS,
  })

  /*
    Once it is finished the hook has already called `router.refresh()`, and the page renders the
    real outcome: the link to the pull request, or the failure with its reason. Rendering nothing
    here avoids showing both at once during the re-render.
  */
  if (latest?.finished) return null

  if (gaveUp) {
    return (
      <div role="status" aria-live="polite" className="card elev-sm mb-3">
        <p className="m-0 text-sm">Still waiting on the worker.</p>
        <p className="text-muted m-0 text-xs">
          The job is queued and has not been lost. The worker runs on GitHub Actions rather than as
          a service that is always up, and scheduled runs can be delayed a long way. This page shows
          the pull request whenever it lands; reload to check.
        </p>
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" className="card elev-sm mb-3">
      <p className="m-0 text-sm">Queued. Waiting for a worker to pick this up.</p>
      <p className="text-muted m-0 text-xs">
        The agent reads your repository, detects the framework, writes the change and opens the pull
        request. It usually starts within a minute or two. You do not need to click again, and this
        updates on its own.
      </p>
    </div>
  )
}
