/**
 * A request rate limiter: how many, per key, per window.
 *
 * In memory, in this process. The product's law is one Postgres and no Redis (ADR-0007), and the
 * API is one instance, so a counter in the process is the whole truth. A row per request would
 * turn every flood into a flood of writes, which is the opposite of a defence. If the API is ever
 * scaled to several instances this becomes "per instance", which is looser and still bounded;
 * that is the trigger to move the counters, and it is written here so nobody discovers it.
 *
 * A fixed window, not a sliding one. A fixed window allows a burst of up to twice the limit
 * across a boundary, which matters for billing-grade quotas and not for this. What it buys is one
 * number and one timestamp per key, so a flood of distinct keys costs almost nothing to hold.
 *
 * This is a flood guard. It is not the thing that protects money: paid calls are capped per
 * tenant per month in Postgres by the budget guard, which survives a restart and this does not.
 */
export interface RateLimitRule {
  /** Requests allowed in one window. */
  limit: number
  windowMs: number
}

export interface RateLimitDecision {
  allowed: boolean
  /** Requests left in this window after this one. Zero when refused. */
  remaining: number
  /** Whole seconds until the window resets. At least one. */
  retryAfterSeconds: number
}

interface Window {
  count: number
  resetsAt: number
}

/**
 * How many keys are held before old ones are dropped.
 *
 * Without a ceiling the limiter is itself the denial of service: an attacker who can choose the
 * key (any address, any token) grows this map until the process dies. At about 100 bytes a key
 * this is a few megabytes at most.
 */
const MAX_KEYS = 50_000

export class RateLimiter {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = MAX_KEYS,
  ) {}

  /** Count one request against a key. The answer says whether it may proceed. */
  take(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.now()
    let window = this.windows.get(key)

    if (!window || window.resetsAt <= now) {
      if (!window && this.windows.size >= this.maxKeys) this.evict(now)
      window = { count: 0, resetsAt: now + rule.windowMs }
      this.windows.set(key, window)
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetsAt - now) / 1000))

    if (window.count >= rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds }
    }

    window.count += 1
    return { allowed: true, remaining: rule.limit - window.count, retryAfterSeconds }
  }

  /** How many keys are held. For tests and for a health figure. */
  get size(): number {
    return this.windows.size
  }

  /**
   * Make room. Expired windows go first, since they hold nothing. If the map is still full, every
   * key is live, which only happens under a flood of distinct keys; the oldest tenth are dropped.
   * Dropping a live window forgives that key's count, which is the cheaper mistake: the
   * alternative is refusing to track new keys, and then the flood is unlimited.
   */
  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key)
    }
    if (this.windows.size < this.maxKeys) return

    let toDrop = Math.ceil(this.maxKeys / 10)
    // A Map iterates in insertion order, so the first keys are the oldest.
    for (const key of this.windows.keys()) {
      if (toDrop-- <= 0) break
      this.windows.delete(key)
    }
  }
}
