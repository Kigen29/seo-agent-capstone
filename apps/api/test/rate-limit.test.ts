import { describe, expect, it } from 'vitest'
import { RateLimiter } from '../src/rate-limit.js'

/**
 * The limiter on its own, with a clock the test owns.
 *
 * Its two jobs pull against each other, and both are checked: it has to refuse a key that asks
 * too often, and it has to do that without becoming the way to exhaust the server's memory.
 */
const clock = (start = 1_000_000) => {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

const RULE = { limit: 3, windowMs: 60_000 }

describe('RateLimiter', () => {
  it('allows up to the limit and refuses the next one', () => {
    const limiter = new RateLimiter(clock().now)

    expect(limiter.take('a', RULE)).toMatchObject({ allowed: true, remaining: 2 })
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: true, remaining: 1 })
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: true, remaining: 0 })
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: false, remaining: 0 })
  })

  it('counts each key separately', () => {
    const limiter = new RateLimiter(clock().now)
    for (let i = 0; i < 3; i++) limiter.take('a', RULE)

    expect(limiter.take('a', RULE).allowed).toBe(false)
    expect(limiter.take('b', RULE).allowed).toBe(true)
  })

  it('says how long to wait, and allows again once the window has passed', () => {
    const time = clock()
    const limiter = new RateLimiter(time.now)
    for (let i = 0; i < 3; i++) limiter.take('a', RULE)

    time.advance(45_000)
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: false, retryAfterSeconds: 15 })

    time.advance(15_000)
    expect(limiter.take('a', RULE)).toMatchObject({ allowed: true, remaining: 2 })
  })

  it('does not count a refused request, so hammering does not extend the wait', () => {
    const time = clock()
    const limiter = new RateLimiter(time.now)
    for (let i = 0; i < 50; i++) limiter.take('a', RULE)

    time.advance(60_000)
    expect(limiter.take('a', RULE).allowed).toBe(true)
  })

  it('never tells a caller to retry in zero seconds', () => {
    const time = clock()
    const limiter = new RateLimiter(time.now)
    for (let i = 0; i < 3; i++) limiter.take('a', RULE)

    time.advance(59_999)
    expect(limiter.take('a', RULE).retryAfterSeconds).toBe(1)
  })

  it('holds a bounded number of keys however many distinct callers arrive', () => {
    const limiter = new RateLimiter(clock().now, 100)

    // A flood of addresses that never repeat, which is what tries to exhaust memory.
    for (let i = 0; i < 10_000; i++) limiter.take(`flood-${i}`, RULE)

    expect(limiter.size).toBeLessThanOrEqual(100)
  })

  it('drops expired windows before live ones when it needs room', () => {
    const time = clock()
    const limiter = new RateLimiter(time.now, 4)
    limiter.take('old-1', RULE)
    limiter.take('old-2', RULE)
    time.advance(60_000)

    for (let i = 0; i < 3; i++) limiter.take('live', RULE)
    limiter.take('live-2', RULE)
    limiter.take('newcomer', RULE)
    limiter.take('another', RULE)

    // The key that had used its allowance is still refused: making room cost it nothing.
    expect(limiter.take('live', RULE).allowed).toBe(false)
  })
})
