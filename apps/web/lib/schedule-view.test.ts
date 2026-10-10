import type { ScheduleEvent } from '@seo/api-client'
import { describe, expect, it } from 'vitest'
import {
  byDay,
  googleCalendarUrl,
  KIND,
  recorded,
  STATE,
  upcoming,
  withSite,
} from './schedule-view'

const event = (over: Partial<ScheduleEvent>): ScheduleEvent => ({
  id: `${over.kind ?? 'audit'}:${over.day ?? '2026-10-10'}`,
  kind: 'audit',
  day: '2026-10-10',
  state: 'scheduled',
  title: 'Scheduled audit',
  detail: 'Runs every 7 days.',
  ...over,
})

const TODAY = '2026-10-10'

describe('byDay', () => {
  it('groups events under the day they fall on, keeping their order', () => {
    const days = byDay([
      event({ id: 'a', day: '2026-10-10' }),
      event({ id: 'b', day: '2026-10-11' }),
      event({ id: 'c', day: '2026-10-10' }),
    ])
    expect(days.get('2026-10-10')!.map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(days.get('2026-10-11')).toHaveLength(1)
    expect(days.get('2026-10-12')).toBeUndefined()
  })
})

describe('upcoming', () => {
  const poll = (day: string, state: ScheduleEvent['state'] = 'scheduled') =>
    event({ id: `poll:${day}`, kind: 'visibility_poll', day, state, title: 'AI answers check' })

  it('leaves out what has already happened', () => {
    const rows = upcoming(
      [event({ day: '2026-10-09', state: 'done' }), event({ day: TODAY, state: 'done' })],
      TODAY,
    )
    expect(rows).toEqual([])
  })

  it('folds the daily check after today into one row that says how long it runs', () => {
    const rows = upcoming(
      [poll(TODAY, 'due'), poll('2026-10-11'), poll('2026-10-12'), poll('2026-10-13')],
      TODAY,
    )
    expect(rows).toHaveLength(2)
    // Today's is its own row, because whether today's has run is news.
    expect(rows[0]).toMatchObject({ day: TODAY, state: 'due' })
    expect(rows[0]!.dailyUntil).toBeUndefined()
    expect(rows[1]).toMatchObject({
      key: 'poll:daily',
      day: '2026-10-11',
      dailyUntil: '2026-10-13',
    })
  })

  it('does not call one remaining day a run', () => {
    const [row] = upcoming([poll('2026-10-11')], TODAY)
    expect(row!.dailyUntil).toBeUndefined()
  })

  it('keeps everything that happens once, in day order', () => {
    const rows = upcoming(
      [
        event({ id: 'read', kind: 'competitor_read', day: '2026-10-14' }),
        event({ id: 'audit', day: '2026-10-12' }),
        poll('2026-10-11'),
        poll('2026-10-20'),
      ],
      TODAY,
    )
    expect(rows.map((row) => row.key)).toEqual(['poll:daily', 'audit', 'read'])
  })

  it('shows an audit that is running now', () => {
    const rows = upcoming([event({ day: TODAY, state: 'running' })], TODAY)
    expect(rows).toHaveLength(1)
  })
})

describe('recorded', () => {
  it('is what ran or failed, newest first', () => {
    const rows = recorded([
      event({ id: 'old', day: '2026-10-02', state: 'done' }),
      event({ id: 'failed', day: '2026-10-08', state: 'failed' }),
      event({ id: 'next', day: '2026-10-12', state: 'scheduled' }),
    ])
    expect(rows.map((row) => row.id)).toEqual(['failed', 'old'])
  })
})

describe('labels', () => {
  it('names every kind and every state, and never by colour alone', () => {
    for (const kind of Object.values(KIND)) {
      expect(kind.label).not.toBe('')
      expect(kind.what).not.toContain('—')
    }
    const marks = Object.values(STATE).map((state) => state.mark)
    expect(new Set(marks).size).toBe(marks.length)
  })
})

describe('withSite', () => {
  it('carries the site on a link from the calendar', () => {
    expect(withSite('/audits', 's1')).toBe('/audits?siteId=s1')
    expect(withSite('/findings?sort=title', 's1')).toBe('/findings?sort=title&siteId=s1')
  })
})

describe('googleCalendarUrl', () => {
  const context = { site: 'example.com', siteId: 's1', origin: 'https://app.example' }
  const params = (url: string) => new URL(url).searchParams

  it('opens Google Calendar with an all-day entry on the day', () => {
    const url = googleCalendarUrl(
      {
        key: 'a',
        kind: 'audit',
        state: 'scheduled',
        day: '2026-10-31',
        title: 'Scheduled audit',
        detail: 'Runs every 7 days.',
        href: '/audits',
      },
      context,
    )
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
    expect(params(url).get('action')).toBe('TEMPLATE')
    expect(params(url).get('text')).toBe('Scheduled audit (example.com)')
    // All day: it ends on the day after, here across a month end.
    expect(params(url).get('dates')).toBe('20261031/20261101')
    expect(params(url).get('recur')).toBeNull()
  })

  it('links back to the page that will hold the result, for the right site', () => {
    const url = googleCalendarUrl(
      {
        key: 'a',
        kind: 'audit',
        state: 'due',
        day: '2026-10-10',
        title: 'Scheduled audit',
        detail: 'Due now.',
        href: '/audits',
      },
      context,
    )
    expect(params(url).get('details')).toContain('https://app.example/audits?siteId=s1')
    expect(params(url).get('details')).toContain('not at a set hour')
  })

  it('makes the daily check one repeating entry that ends on its last day', () => {
    const url = googleCalendarUrl(
      {
        key: 'poll:daily',
        kind: 'visibility_poll',
        state: 'scheduled',
        day: '2026-10-11',
        dailyUntil: '2026-11-01',
        title: 'AI answers check',
        detail: '5 questions.',
      },
      context,
    )
    expect(params(url).get('dates')).toBe('20261011/20261012')
    expect(params(url).get('recur')).toBe('RRULE:FREQ=DAILY;UNTIL=20261101')
  })

  it('carries no account detail beyond the site and the run', () => {
    const url = googleCalendarUrl(
      {
        key: 'a',
        kind: 'competitor_read',
        state: 'scheduled',
        day: '2026-10-14',
        title: 'Read rival.example',
        detail: 'A few public pages.',
      },
      context,
    )
    expect([...params(url).keys()].sort()).toEqual(['action', 'dates', 'details', 'text'])
  })
})
