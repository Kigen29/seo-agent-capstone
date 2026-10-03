import { verificationResultSchema } from '@seo/core'
import { describe, expect, it, vi } from 'vitest'
import { verificationFor } from '../src/outcome-evidence.js'
import {
  addTraffic,
  CLICKS_METRIC,
  hasTraffic,
  IMPRESSIONS_METRIC,
  measurePageTraffic,
  trafficReadyAt,
  trafficWindows,
} from '../src/traffic-outcome.js'

describe('traffic outcome', () => {
  it('compares equal 28-day windows either side of the fix', () => {
    const { before, after } = trafficWindows(
      new Date('2026-09-01T10:00:00Z'),
      new Date('2026-09-05T10:00:00Z'),
    )
    expect(before).toEqual({ startDate: '2026-08-04', endDate: '2026-08-31' })
    expect(after).toEqual({ startDate: '2026-09-05', endDate: '2026-10-02' })
  })

  it('waits for the after-window plus the Search Console lag', () => {
    expect(trafficReadyAt(new Date('2026-09-05T10:00:00Z')).toISOString()).toBe(
      '2026-10-06T10:00:00.000Z',
    )
  })

  it('sums only the fixed pages, whichever host form Search Console reports', async () => {
    const searchAnalytics = vi.fn(async () => [
      { keys: ['https://www.ex.com/about'], clicks: 5, impressions: 100 },
      { keys: ['https://ex.com/contact/'], clicks: 2, impressions: 40 },
      { keys: ['https://ex.com/other'], clicks: 99, impressions: 999 },
    ])
    const traffic = await measurePageTraffic(
      { searchAnalytics },
      'sc-domain:ex.com',
      ['https://ex.com/about', 'https://www.ex.com/contact'],
      { startDate: '2026-09-05', endDate: '2026-10-02' },
    )
    expect(traffic).toEqual({ clicks: 7, impressions: 140 })
    expect(searchAnalytics).toHaveBeenCalledWith('sc-domain:ex.com', {
      startDate: '2026-09-05',
      endDate: '2026-10-02',
      dimensions: ['page'],
      rowLimit: 25_000,
      startRow: 0,
    })
  })

  it('adds both windows to the record, idempotently, and still validates', () => {
    const merged = { id: 'r', ruleId: 'TECH-022', affectedUrls: ['https://ex.com/a'] }
    const record = verificationFor(merged, 'verified', [], new Date('2026-09-05T10:00:00Z'))
    expect(hasTraffic(record)).toBe(false)

    const once = addTraffic(record, { clicks: 0, impressions: 3 }, { clicks: 12, impressions: 300 })
    const twice = addTraffic(once, { clicks: 0, impressions: 3 }, { clicks: 12, impressions: 300 })
    expect(verificationResultSchema.parse(twice)).toBeTruthy()
    expect(hasTraffic(twice)).toBe(true)
    const value = (snapshot: typeof twice.after, name: string) =>
      snapshot.metrics.filter((m) => m.metric === name).map((m) => m.value)
    expect(value(twice.after, CLICKS_METRIC)).toEqual([12])
    expect(value(twice.before, CLICKS_METRIC)).toEqual([0])
    expect(value(twice.after, IMPRESSIONS_METRIC)).toEqual([300])
    // The rule-level measurement is untouched.
    expect(twice.after.metrics[0]!.metric).toBe('TECH-022 failing pages')
  })
})

it('finds affected pages beyond the first full GSC response', async () => {
  const searchAnalytics = vi
    .fn()
    .mockResolvedValueOnce(
      Array.from({ length: 25_000 }, () => ({
        keys: ['https://ex.com/other'],
        clicks: 1,
        impressions: 1,
      })),
    )
    .mockResolvedValueOnce([{ keys: ['https://ex.com/affected'], clicks: 9, impressions: 90 }])
  expect(
    await measurePageTraffic({ searchAnalytics }, 'sc-domain:ex.com', ['https://ex.com/affected'], {
      startDate: '2026-01-01',
      endDate: '2026-01-28',
    }),
  ).toEqual({ clicks: 9, impressions: 90 })
  expect(searchAnalytics.mock.calls[1]?.[1].startRow).toBe(25_000)
})
