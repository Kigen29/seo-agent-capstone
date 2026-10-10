import { z } from 'zod'

/**
 * What runs for a site and when: the calendar, as a pure function of what is already stored.
 *
 * Nothing here is a second schedule. The worker decides what is due by asking the database on
 * every wake ("which site has prompts and no row for today"), and there is no table of future
 * jobs to read. So the calendar is derived from the same facts the worker's own queries use: a
 * past entry is something that was recorded, and a future entry is what those queries will find
 * due on that day if nothing changes. A calendar stored separately would be a promise that could
 * drift from what the worker does; this one cannot say anything the worker would not do
 * (ADR-0044).
 *
 * Days, not times. The worker is woken by a GitHub Actions schedule that runs late and sometimes
 * not at all for an hour, so "09:00" would be a figure nobody could keep. A day is what can be
 * promised, and every day here is a UTC day because that is the day the checks table keys on.
 */

/** How often a site is audited without anybody pressing the button. Off until chosen. */
export const auditCadenceSchema = z.enum(['off', 'weekly', 'monthly'])
export type AuditCadence = z.infer<typeof auditCadenceSchema>

/** Days between scheduled audits. "Monthly" is thirty days, and the page says so. */
export const AUDIT_CADENCE_DAYS: Record<Exclude<AuditCadence, 'off'>, number> = {
  weekly: 7,
  monthly: 30,
}

/**
 * An audit that failed is tried again after this many days, whatever the cadence.
 *
 * Without it a failure costs the whole interval: a site on a monthly schedule whose host was
 * down for an hour would go two months between audits. One day, and not at once, because a site
 * that fails every time would otherwise be crawled on every wake of the worker, forever.
 */
export const FAILED_AUDIT_RETRY_DAYS = 1

/** A competitor is read again once its last reading is this old (ADR-0034). */
export const COMPETITOR_READ_INTERVAL_DAYS = 7

export const scheduleKindSchema = z.enum([
  'audit',
  'visibility_poll',
  'competitor_read',
  'traffic_outcome',
])
export type ScheduleKind = z.infer<typeof scheduleKindSchema>

/**
 * done: recorded. failed: recorded as having failed. running: in flight now.
 * due: the worker will pick it up on its next wake. scheduled: a later day.
 */
export const scheduleStateSchema = z.enum(['done', 'failed', 'running', 'due', 'scheduled'])
export type ScheduleState = z.infer<typeof scheduleStateSchema>

export const scheduleEventSchema = z.object({
  /** Stable for one event on one day, so a list can be keyed and a calendar entry updated. */
  id: z.string(),
  kind: scheduleKindSchema,
  /** The UTC day, `YYYY-MM-DD`. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state: scheduleStateSchema,
  title: z.string(),
  detail: z.string(),
  /** Where in the app the result is, or will be. A path, never an origin. */
  href: z.string().optional(),
})
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>

const DAY_MS = 86_400_000

/** The UTC day a moment falls on. */
export function utcDayOf(moment: Date): string {
  return moment.toISOString().slice(0, 10)
}

/** Midnight UTC at the start of a `YYYY-MM-DD` day. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

export function addDays(day: string, count: number): string {
  return utcDayOf(new Date(dayStart(day).getTime() + count * DAY_MS))
}

/**
 * The days a month's calendar shows: whole weeks, Monday first, covering the month.
 *
 * Whole weeks because a grid is drawn in rows of seven, and the days that spill over from the
 * neighbouring months are shown rather than left blank: an audit due on the 1st belongs on the
 * same row as the 30th before it.
 */
export function monthWindow(month: string): { from: string; to: string; days: string[] } {
  const first = dayStart(`${month}-01`)
  if (Number.isNaN(first.getTime())) throw new Error(`Not a month: ${month}`)
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
  // getUTCDay is 0 for Sunday. Monday first, so Sunday is six days after the week began.
  const lead = (first.getUTCDay() + 6) % 7
  const trail = 6 - ((last.getUTCDay() + 6) % 7)
  const from = addDays(utcDayOf(first), -lead)
  const to = addDays(utcDayOf(last), trail)
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return { from, to, days }
}

/** The month before or after, as `YYYY-MM`. */
export function shiftMonth(month: string, by: number): string {
  const first = dayStart(`${month}-01`)
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + by, 1))
    .toISOString()
    .slice(0, 7)
}

/**
 * The day the next scheduled audit is due, or null when audits are not scheduled.
 *
 * One function, used by the calendar and by the worker's sweep, so the day the page shows is the
 * day the worker acts. A site never audited, or one whose turn has passed, is due today: a late
 * worker does the work late, it does not skip it.
 */
export function nextAuditDay(
  cadence: AuditCadence,
  lastAuditAt: Date | null,
  now: Date,
  /** The newest audit did not finish, so the next is a retry and not a full interval away. */
  lastAuditFailed = false,
): string | null {
  if (cadence === 'off') return null
  const today = utcDayOf(now)
  if (!lastAuditAt) return today
  const wait = lastAuditFailed ? FAILED_AUDIT_RETRY_DAYS : AUDIT_CADENCE_DAYS[cadence]
  const due = addDays(utcDayOf(lastAuditAt), wait)
  return due < today ? today : due
}

export interface ScheduleInput {
  auditCadence: AuditCadence
  /** Audits that started inside the window, any status. */
  audits: { id: string; status: string; startedAt: Date; pagesCrawled: number }[]
  /** The newest audit of the site whenever it was, which is what the next one is counted from. */
  lastAuditAt: Date | null
  /** The newest audit failed, so the next one is a retry a day later. */
  lastAuditFailed?: boolean
  /** An audit is queued or running right now, so no other is due until it ends. */
  auditInFlight: boolean
  /** How many questions the site tracks. With none there is nothing to poll. */
  promptCount: number
  /** Days inside the window on which answers were recorded, with how many. */
  polledDays: { day: string; checks: number }[]
  /** Every tracked competitor and when it was last read, if ever. */
  competitors: { domain: string; lastReadAt: Date | null }[]
  /** Readings taken inside the window. */
  readings: { competitor: string; takenAt: Date; pagesRead: number }[]
  /** Checked fixes whose search-traffic comparison has not been recorded yet. */
  trafficPending: { rowId: string; title: string; readyAt: Date }[]
}

export interface ScheduleWindow {
  from: string
  to: string
  now: Date
}

const AUDIT_STATE: Record<string, ScheduleState> = {
  complete: 'done',
  failed: 'failed',
  queued: 'running',
  crawling: 'running',
  evaluating: 'running',
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/**
 * Every recorded and expected run inside the window, oldest day first.
 *
 * Past days hold only what was recorded. A day with no poll is left empty and not marked missed,
 * because nothing stored says whether there were questions to ask on that day, and a calendar
 * that guessed would be asserting a failure it cannot show.
 */
export function buildSchedule(input: ScheduleInput, window: ScheduleWindow): ScheduleEvent[] {
  const today = utcDayOf(window.now)
  const inWindow = (day: string) => day >= window.from && day <= window.to
  const events: ScheduleEvent[] = []

  // ---- audits ----
  for (const audit of input.audits) {
    const day = utcDayOf(audit.startedAt)
    if (!inWindow(day)) continue
    const state = AUDIT_STATE[audit.status] ?? 'running'
    events.push({
      id: `audit:${audit.id}`,
      kind: 'audit',
      day,
      state,
      title: state === 'failed' ? 'Audit failed' : state === 'running' ? 'Audit running' : 'Audit',
      detail:
        state === 'done'
          ? `${plural(audit.pagesCrawled, 'page')} read and scored.`
          : state === 'failed'
            ? 'The audit did not finish. Open it for the reason.'
            : 'Reading the site now.',
      href: `/audits/${audit.id}`,
    })
  }

  if (input.auditCadence !== 'off' && !input.auditInFlight) {
    const every = AUDIT_CADENCE_DAYS[input.auditCadence]
    const retry = input.lastAuditFailed === true
    let due = nextAuditDay(input.auditCadence, input.lastAuditAt, window.now, retry)
    let first = true
    while (due && due <= window.to) {
      if (inWindow(due)) {
        events.push({
          id: `audit:next:${due}`,
          kind: 'audit',
          day: due,
          state: due === today ? 'due' : 'scheduled',
          title: first && retry ? 'Audit, tried again' : 'Scheduled audit',
          detail:
            first && retry
              ? 'The last audit did not finish, so it is tried again a day later and not a full interval later.'
              : due === today
                ? 'Due now. It starts the next time the worker wakes, usually within the hour.'
                : `Runs every ${every} days. Each one after the next assumes the one before ran on its day.`,
          href: '/audits',
        })
      }
      first = false
      due = addDays(due, every)
    }
  }

  // ---- AI visibility polls ----
  const polled = new Map(input.polledDays.map((entry) => [entry.day, entry.checks]))
  for (const [day, checks] of polled) {
    if (!inWindow(day)) continue
    events.push({
      id: `poll:${day}`,
      kind: 'visibility_poll',
      day,
      state: 'done',
      title: 'AI answers checked',
      detail: `${plural(checks, 'answer')} recorded.`,
      href: '/visibility',
    })
  }
  if (input.promptCount > 0) {
    const first = today > window.from ? today : window.from
    for (let day = first; day <= window.to; day = addDays(day, 1)) {
      if (polled.has(day)) continue
      events.push({
        id: `poll:${day}`,
        kind: 'visibility_poll',
        day,
        state: day === today ? 'due' : 'scheduled',
        title: 'AI answers check',
        detail: `${plural(input.promptCount, 'question')}, asked once a day on each engine that is switched on.`,
        href: '/visibility',
      })
    }
  }

  // ---- competitor readings ----
  for (const reading of input.readings) {
    const day = utcDayOf(reading.takenAt)
    if (!inWindow(day)) continue
    events.push({
      id: `read:${reading.competitor}:${day}`,
      kind: 'competitor_read',
      day,
      state: 'done',
      title: `Read ${reading.competitor}`,
      detail:
        reading.pagesRead > 0
          ? `${plural(reading.pagesRead, 'page')} read and compared with the week before.`
          : 'Looked, and could not read it. The competitors page says why.',
      href: '/competitors',
    })
  }
  for (const competitor of input.competitors) {
    let due = competitor.lastReadAt
      ? addDays(utcDayOf(competitor.lastReadAt), COMPETITOR_READ_INTERVAL_DAYS)
      : today
    if (due < today) due = today
    for (; due <= window.to; due = addDays(due, COMPETITOR_READ_INTERVAL_DAYS)) {
      if (!inWindow(due)) continue
      events.push({
        id: `read:${competitor.domain}:${due}`,
        kind: 'competitor_read',
        day: due,
        state: due === today ? 'due' : 'scheduled',
        title: `Read ${competitor.domain}`,
        detail:
          'A few public pages, compared with the last reading. A few competitors are read on each run, so a full list can take a day or two to get through.',
        href: '/competitors',
      })
    }
  }

  // ---- search traffic, before and after a fix ----
  for (const pending of input.trafficPending) {
    const ready = utcDayOf(pending.readyAt)
    const day = ready < today ? today : ready
    if (!inWindow(day)) continue
    events.push({
      id: `traffic:${pending.rowId}`,
      kind: 'traffic_outcome',
      day,
      state: day === today ? 'due' : 'scheduled',
      title: 'Search traffic, before and after a fix',
      detail: `28 days of clicks either side of "${pending.title}". Needs Search Console connected.`,
      href: `/findings/${pending.rowId}`,
    })
  }

  const ORDER: ScheduleKind[] = ['audit', 'visibility_poll', 'competitor_read', 'traffic_outcome']
  return events.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
      a.id.localeCompare(b.id),
  )
}

/** The response the API serves for one site and one month. */
export const siteScheduleSchema = z.object({
  /** `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  from: z.string(),
  to: z.string(),
  /** Today, as a UTC day, so the page marks the same day the schedule was computed for. */
  today: z.string(),
  auditCadence: auditCadenceSchema,
  events: z.array(scheduleEventSchema),
})
export type SiteSchedule = z.infer<typeof siteScheduleSchema>

/** Text in an iCalendar value: backslash, semicolon, comma and newline are escaped. */
const icsText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 octets are folded, with the continuation starting with a space. */
function fold(line: string): string {
  const parts: string[] = []
  let rest = line
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74))
    rest = ` ${rest.slice(74)}`
  }
  parts.push(rest)
  return parts.join('\r\n')
}

/**
 * The same events as an iCalendar file, for a person's own calendar.
 *
 * All-day entries, because a day is all that is promised. `origin` turns each event's path into
 * a link back to the page that holds the result.
 */
export function toIcs(
  events: ScheduleEvent[],
  options: { site: string; origin: string; now: Date },
): string {
  const stamp = options.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RankWright//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`RankWright: ${options.site}`)}`,
  ]
  for (const event of events) {
    const start = event.day.replace(/-/g, '')
    const end = addDays(event.day, 1).replace(/-/g, '')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(`${event.id}@${options.site}`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsText(`${event.title} (${options.site})`)}`,
      `DESCRIPTION:${icsText(event.detail)}`,
      ...(event.href ? [`URL:${options.origin}${event.href}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
