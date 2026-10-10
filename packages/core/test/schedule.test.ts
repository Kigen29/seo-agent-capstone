import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildSchedule,
  monthWindow,
  nextAuditDay,
  shiftMonth,
  toIcs,
  type ScheduleInput,
} from '../src/schedule.js'

const NOW = new Date('2026-10-10T09:30:00Z')
const WINDOW = { ...monthWindow('2026-10'), now: NOW }

const nothing: ScheduleInput = {
  auditCadence: 'off',
  audits: [],
  lastAuditAt: null,
  auditInFlight: false,
  promptCount: 0,
  polledDays: [],
  competitors: [],
  readings: [],
  trafficPending: [],
}

describe('monthWindow', () => {
  it('covers the month in whole weeks, Monday first', () => {
    const window = monthWindow('2026-10')
    // 1 October 2026 is a Thursday, and 31 October a Saturday.
    expect(window.from).toBe('2026-09-28')
    expect(window.to).toBe('2026-11-01')
    expect(window.days).toHaveLength(35)
    expect(window.days.length % 7).toBe(0)
  })

  it('adds no extra week when the month already starts on a Monday', () => {
    // June 2026 starts on a Monday.
    expect(monthWindow('2026-06').from).toBe('2026-06-01')
  })

  it('refuses something that is not a month', () => {
    expect(() => monthWindow('2026-13')).toThrow()
  })

  it('steps a month either way, across a year end', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})

describe('nextAuditDay', () => {
  it('is nothing when audits are not scheduled', () => {
    expect(nextAuditDay('off', new Date('2026-10-01T00:00:00Z'), NOW)).toBeNull()
  })

  it('is today for a site never audited', () => {
    expect(nextAuditDay('weekly', null, NOW)).toBe('2026-10-10')
  })

  it('counts from the last audit', () => {
    expect(nextAuditDay('weekly', new Date('2026-10-08T23:00:00Z'), NOW)).toBe('2026-10-15')
    expect(nextAuditDay('monthly', new Date('2026-10-08T23:00:00Z'), NOW)).toBe('2026-11-07')
  })

  it('is today, not a day in the past, when the turn was missed', () => {
    expect(nextAuditDay('weekly', new Date('2026-09-01T00:00:00Z'), NOW)).toBe('2026-10-10')
  })
})

describe('buildSchedule', () => {
  it('is empty for a site with nothing set up, and invents nothing', () => {
    expect(buildSchedule(nothing, WINDOW)).toEqual([])
  })

  it('shows recorded audits by what became of them', () => {
    const events = buildSchedule(
      {
        ...nothing,
        audits: [
          {
            id: 'a1',
            status: 'complete',
            startedAt: new Date('2026-10-02T10:00:00Z'),
            pagesCrawled: 12,
          },
          {
            id: 'a2',
            status: 'failed',
            startedAt: new Date('2026-10-05T10:00:00Z'),
            pagesCrawled: 0,
          },
          {
            id: 'a3',
            status: 'crawling',
            startedAt: new Date('2026-10-10T09:00:00Z'),
            pagesCrawled: 3,
          },
        ],
      },
      WINDOW,
    )
    expect(events.map((event) => [event.day, event.state])).toEqual([
      ['2026-10-02', 'done'],
      ['2026-10-05', 'failed'],
      ['2026-10-10', 'running'],
    ])
    expect(events[0]!.detail).toBe('12 pages read and scored.')
    expect(events[0]!.href).toBe('/audits/a1')
  })

  it('repeats a weekly audit from the last one to the end of the window', () => {
    const events = buildSchedule(
      { ...nothing, auditCadence: 'weekly', lastAuditAt: new Date('2026-10-06T10:00:00Z') },
      WINDOW,
    )
    expect(events.map((event) => event.day)).toEqual(['2026-10-13', '2026-10-20', '2026-10-27'])
    expect(events.every((event) => event.state === 'scheduled')).toBe(true)
  })

  it('marks an overdue audit as due today', () => {
    const [first] = buildSchedule(
      { ...nothing, auditCadence: 'weekly', lastAuditAt: new Date('2026-09-01T10:00:00Z') },
      WINDOW,
    )
    expect(first).toMatchObject({ day: '2026-10-10', state: 'due' })
  })

  it('schedules no audit while one is running', () => {
    const events = buildSchedule(
      { ...nothing, auditCadence: 'weekly', lastAuditAt: null, auditInFlight: true },
      WINDOW,
    )
    expect(events).toEqual([])
  })

  it('polls daily from today when there are questions, and never fills in the past', () => {
    const events = buildSchedule(
      {
        ...nothing,
        promptCount: 3,
        polledDays: [
          { day: '2026-10-08', checks: 6 },
          { day: '2026-10-10', checks: 6 },
        ],
      },
      WINDOW,
    )
    const polls = events.filter((event) => event.kind === 'visibility_poll')
    // Recorded: the 8th and the 10th. The 9th has no record and is left empty, not "missed".
    expect(polls.find((event) => event.day === '2026-10-09')).toBeUndefined()
    expect(polls.find((event) => event.day === '2026-10-08')).toMatchObject({ state: 'done' })
    // Today is already done, so it is not also due.
    expect(polls.filter((event) => event.day === '2026-10-10')).toHaveLength(1)
    expect(polls.find((event) => event.day === '2026-10-11')).toMatchObject({ state: 'scheduled' })
    expect(polls.at(-1)!.day).toBe(WINDOW.to)
  })

  it('says today is due when today has not been polled yet', () => {
    const events = buildSchedule({ ...nothing, promptCount: 1 }, WINDOW)
    expect(events[0]).toMatchObject({ day: '2026-10-10', state: 'due' })
    expect(events[0]!.detail).toContain('1 question,')
  })

  it('schedules no poll for a site with no questions', () => {
    const events = buildSchedule({ ...nothing, promptCount: 0 }, WINDOW)
    expect(events).toEqual([])
  })

  it('reads each competitor a week after its last reading, and a new one today', () => {
    const events = buildSchedule(
      {
        ...nothing,
        competitors: [
          { domain: 'old.example', lastReadAt: new Date('2026-10-07T03:00:00Z') },
          { domain: 'new.example', lastReadAt: null },
        ],
        readings: [
          { competitor: 'old.example', takenAt: new Date('2026-10-07T03:00:00Z'), pagesRead: 2 },
        ],
      },
      WINDOW,
    )
    const of = (domain: string) =>
      events.filter((event) => event.id.startsWith(`read:${domain}`)).map((e) => [e.day, e.state])
    expect(of('old.example')).toEqual([
      ['2026-10-07', 'done'],
      ['2026-10-14', 'scheduled'],
      ['2026-10-21', 'scheduled'],
      ['2026-10-28', 'scheduled'],
    ])
    expect(of('new.example')[0]).toEqual(['2026-10-10', 'due'])
  })

  it('says a reading that read nothing looked and could not', () => {
    const [event] = buildSchedule(
      {
        ...nothing,
        readings: [
          { competitor: 'shut.example', takenAt: new Date('2026-10-03T03:00:00Z'), pagesRead: 0 },
        ],
      },
      WINDOW,
    )
    expect(event!.detail).toMatch(/could not read/)
  })

  it('puts a traffic comparison on the day its window closes', () => {
    const events = buildSchedule(
      {
        ...nothing,
        trafficPending: [
          { rowId: 'f1', title: 'No sitemap', readyAt: new Date('2026-10-20T00:00:00Z') },
          { rowId: 'f2', title: 'Late', readyAt: new Date('2026-12-20T00:00:00Z') },
        ],
      },
      WINDOW,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      day: '2026-10-20',
      kind: 'traffic_outcome',
      href: '/findings/f1',
    })
  })

  it('gives every event on a day its own id, and orders by day', () => {
    const events = buildSchedule(
      {
        ...nothing,
        auditCadence: 'weekly',
        promptCount: 2,
        competitors: [{ domain: 'a.example', lastReadAt: null }],
      },
      WINDOW,
    )
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
    expect(events.map((event) => event.day)).toEqual([...events.map((event) => event.day)].sort())
    // An audit leads its day.
    expect(events[0]!.kind).toBe('audit')
  })

  it('writes no em dash in anything a person reads', () => {
    const events = buildSchedule(
      {
        ...nothing,
        auditCadence: 'monthly',
        promptCount: 2,
        competitors: [{ domain: 'a.example', lastReadAt: null }],
        trafficPending: [{ rowId: 'f1', title: 'x', readyAt: NOW }],
      },
      WINDOW,
    )
    for (const event of events) expect(`${event.title} ${event.detail}`).not.toContain('—')
  })
})

describe('toIcs', () => {
  const events = buildSchedule({ ...nothing, auditCadence: 'weekly' }, WINDOW)
  const ics = toIcs(events, { site: 'example.com', origin: 'https://app.example', now: NOW })

  it('is a calendar of all-day entries', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261010')
    // An all-day entry ends on the day after it starts.
    expect(ics).toContain(`DTEND;VALUE=DATE:${addDays('2026-10-10', 1).replace(/-/g, '')}`)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(events.length)
  })

  it('links each entry back to its page', () => {
    expect(ics).toContain('URL:https://app.example/audits')
  })

  it('escapes commas and folds long lines', () => {
    // Unfolded, the text is whole again: a fold is a line break and one space.
    expect(ics.split('\r\n ').join('')).toContain('usually within the hour')
    expect(ics).toContain('\\,')
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75)
  })
})

describe('a failed audit', () => {
  const failedAt = new Date('2026-10-08T10:00:00Z')

  it('is retried the next day, not a full interval later', () => {
    expect(nextAuditDay('monthly', failedAt, NOW, true)).toBe('2026-10-10')
    expect(nextAuditDay('weekly', new Date('2026-10-10T08:00:00Z'), NOW, true)).toBe('2026-10-11')
    // A success waits the interval as before.
    expect(nextAuditDay('weekly', new Date('2026-10-10T08:00:00Z'), NOW, false)).toBe('2026-10-17')
  })

  it('is not retried on the day it failed, so a site that always fails is tried once a day', () => {
    expect(nextAuditDay('weekly', NOW, NOW, true)).not.toBe('2026-10-10')
  })

  it('shows on the calendar as a retry, and the ones after it at the usual interval', () => {
    const events = buildSchedule(
      {
        ...nothing,
        auditCadence: 'weekly',
        lastAuditAt: new Date('2026-10-10T08:00:00Z'),
        lastAuditFailed: true,
      },
      WINDOW,
    )
    expect(events.map((event) => [event.day, event.title])).toEqual([
      ['2026-10-11', 'Audit, tried again'],
      ['2026-10-18', 'Scheduled audit'],
      ['2026-10-25', 'Scheduled audit'],
      ['2026-11-01', 'Scheduled audit'],
    ])
    expect(events[0]!.detail).toMatch(/did not finish/)
  })

  it('schedules no retry when audits are off', () => {
    expect(nextAuditDay('off', failedAt, NOW, true)).toBeNull()
  })
})
