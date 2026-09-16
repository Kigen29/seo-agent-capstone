'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Poll a server action until the thing it describes is finished, then refresh once.
 *
 * Extracted from `LiveProgress` when the fix flow needed the same behaviour. What the two screens
 * share is the *mechanism*, not the markup: poll a small payload, stop when it is done, refresh
 * the server component exactly once so the page picks up the new content. What they do not share
 * is anything a user sees, which is why this is a hook and not a component with a `variant` prop.
 *
 * Polling rather than a socket, for the reason `LiveProgress` already gives: it survives the API
 * sleeping and waking underneath it, which a long-lived connection on a free instance would not.
 *
 * `giveUpAfterMs` exists because the two callers wait on different things. A crawl is already
 * running and will end; a fix job is waiting on a GitHub Actions runner, which is dispatched
 * promptly but is not guaranteed to be, and polling every two seconds for hours would be a
 * background tab quietly burning somebody's battery. A caller that can wait forever omits it.
 */
export interface PollableProgress {
  finished: boolean
}

export function usePolledProgress<T extends PollableProgress>({
  enabled,
  poll,
  intervalMs = 2000,
  maxIntervalMs,
  giveUpAfterMs,
}: {
  enabled: boolean
  poll: () => Promise<T | null>
  /** The first gap between polls, and every gap unless `maxIntervalMs` widens it. */
  intervalMs?: number
  /** Back off towards this, doubling each time. Omit to poll at a constant rate. */
  maxIntervalMs?: number
  /** Stop waiting after this long, and say so. Omit to wait for as long as the page is open. */
  giveUpAfterMs?: number
}): { latest: T | null; gaveUp: boolean } {
  const router = useRouter()
  const [latest, setLatest] = useState<T | null>(null)
  const [gaveUp, setGaveUp] = useState(false)

  /*
    The poll function is read through a ref rather than listed as a dependency.

    Callers pass a server action wrapped in an arrow, which is a new identity on every render. As
    a dependency that would tear down and restart the timer on each render, which resets the
    backoff and the give-up clock, so the poll would never actually slow down or stop.
  */
  const pollRef = useRef(poll)
  useEffect(() => {
    pollRef.current = poll
  })

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let wait = intervalMs
    const startedAt = Date.now()
    setGaveUp(false)

    const tick = async () => {
      const progress = await pollRef.current()
      if (cancelled) return

      if (progress) {
        setLatest(progress)

        // One refresh, at the end, when there is genuinely new content to show.
        if (progress.finished) {
          router.refresh()
          return
        }
      }

      if (giveUpAfterMs !== undefined && Date.now() - startedAt >= giveUpAfterMs) {
        setGaveUp(true)
        return
      }

      if (maxIntervalMs !== undefined) wait = Math.min(wait * 2, maxIntervalMs)
      timer = setTimeout(() => void tick(), wait)
    }

    timer = setTimeout(() => void tick(), wait)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, intervalMs, maxIntervalMs, giveUpAfterMs, router])

  return { latest, gaveUp }
}
