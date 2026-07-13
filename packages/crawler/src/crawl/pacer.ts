/**
 * Rate limiting, shared across all crawl workers.
 *
 * "The crawler hammers a site and gets blocked" is the failure this story is written
 * against, so pacing is a correctness property, not a nicety. The gate is global rather
 * than per-worker: with three workers and a 1s delay, a per-worker gate would still put
 * three requests a second on the origin, which is exactly what we promised not to do.
 */
export class Pacer {
  private nextAllowedAt = 0

  constructor(private readonly minIntervalMs: number) {}

  /** Resolves when it is this caller's turn. Reserves the slot before awaiting. */
  async wait(now: () => number = Date.now, sleep = defaultSleep): Promise<void> {
    if (this.minIntervalMs <= 0) return

    const current = now()
    const runAt = Math.max(current, this.nextAllowedAt)

    // Reserve the slot synchronously. If we awaited first, two workers arriving in the
    // same tick would both read the same nextAllowedAt and both fire immediately.
    this.nextAllowedAt = runAt + this.minIntervalMs

    const delay = runAt - current
    if (delay > 0) await sleep(delay)
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
