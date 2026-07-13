import { describe, expect, it } from 'vitest'
import { Pacer } from '../src/crawl/pacer.js'

/** A fake clock, so pacing is tested by arithmetic rather than by actually waiting. */
function fakeClock() {
  let now = 1_000
  const slept: number[] = []

  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms)
      now += ms
    },
    slept,
  }
}

describe('Pacer', () => {
  it('does not wait for the first request', async () => {
    const clock = fakeClock()
    await new Pacer(100).wait(clock.now, clock.sleep)

    expect(clock.slept).toEqual([])
    expect(clock.now()).toBe(1_000)
  })

  it('enforces the interval between consecutive requests', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(100)

    await pacer.wait(clock.now, clock.sleep)
    await pacer.wait(clock.now, clock.sleep)
    await pacer.wait(clock.now, clock.sleep)

    // Three requests, two gaps of 100ms. Asserting on the clock rather than on the raw
    // sleep amounts, because a sleep advances the clock and so the delays are relative.
    expect(clock.now()).toBe(1_200)
    expect(clock.slept).toHaveLength(2)
  })

  it('is a GLOBAL gate, so concurrent workers queue behind each other', async () => {
    // The bug this pins: with a per-worker gate, three workers arriving in the same tick
    // would each see an unclaimed slot and all fire at once. Three requests, no spacing,
    // on someone else's origin. That is the "hammers the site" failure, exactly.
    //
    // A per-worker gate leaves the clock at 1000 and sleeps nothing. A global one has to
    // push the last worker out to 1200.
    const clock = fakeClock()
    const pacer = new Pacer(100)

    await Promise.all([
      pacer.wait(clock.now, clock.sleep),
      pacer.wait(clock.now, clock.sleep),
      pacer.wait(clock.now, clock.sleep),
    ])

    expect(clock.now()).toBe(1_200)
    expect(clock.slept).toHaveLength(2)
  })

  it('does nothing when the interval is zero', async () => {
    const clock = fakeClock()
    const pacer = new Pacer(0)

    await pacer.wait(clock.now, clock.sleep)
    await pacer.wait(clock.now, clock.sleep)

    expect(clock.slept).toEqual([])
    expect(clock.now()).toBe(1_000)
  })
})
