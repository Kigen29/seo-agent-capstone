import type { ScheduleEvent, ScheduleKind, ScheduleState } from '@seo/api-client'

/**
 * How the schedule is laid out on the page: what a kind is called, what a state looks like, and
 * which events make the two lists under the calendar.
 *
 * Pure, and apart from the page, so the grouping can be tested without rendering anything.
 */

export const KIND: Record<
  ScheduleKind,
  { label: string; short: string; className: string; what: string }
> = {
  audit: {
    label: 'Audit',
    short: 'Audit',
    className: 'tag tag-accent',
    what: 'The whole site is read and scored again, and the findings are brought up to date.',
  },
  visibility_poll: {
    label: 'AI answers check',
    short: 'AI check',
    className: 'tag tag-neutral',
    what: 'Each question you track is asked once, and whether you were cited is recorded.',
  },
  competitor_read: {
    label: 'Competitor reading',
    short: 'Competitor',
    className: 'tag tag-outline',
    what: 'A few public pages of one competitor are read and compared with the week before.',
  },
  traffic_outcome: {
    label: 'Traffic after a fix',
    short: 'Traffic',
    className: 'tag tag-success',
    what: 'Search clicks for 28 days before and after a fix, read from Search Console.',
  },
}

/**
 * A mark and a word for each state. The mark is what a sighted reader scans for and the word is
 * what a screen reader says, so the state is never carried by colour alone.
 */
export const STATE: Record<ScheduleState, { mark: string; label: string; what: string }> = {
  done: { mark: '✓', label: 'Done', what: 'It ran, and the result is recorded.' },
  failed: {
    mark: '!',
    label: 'Failed',
    what: 'It ran and did not finish. Open it for the reason.',
  },
  running: { mark: '…', label: 'Running', what: 'It is in progress now.' },
  due: {
    mark: '●',
    label: 'Due today',
    what: 'It starts the next time the worker wakes, usually within the hour.',
  },
  scheduled: { mark: '○', label: 'Scheduled', what: 'It is expected on that day.' },
}

/** Every event on each day, in the order the API sent them. */
export function byDay(events: ScheduleEvent[]): Map<string, ScheduleEvent[]> {
  const days = new Map<string, ScheduleEvent[]>()
  for (const event of events) {
    const list = days.get(event.day)
    if (list) list.push(event)
    else days.set(event.day, [event])
  }
  return days
}

export interface AgendaRow {
  key: string
  kind: ScheduleKind
  state: ScheduleState
  /** The day, or the first day of a run that repeats daily. */
  day: string
  /** Set when this row stands for the same thing on every day up to and including this one. */
  dailyUntil?: string
  title: string
  detail: string
  href?: string
}

/**
 * What is still to come, from today on, as rows a person can read down.
 *
 * The daily AI check would otherwise be twenty rows saying the same thing, one a day, burying
 * the audit and the readings that happen once. So today's check keeps its own row, because
 * whether today's has run is news, and the later ones become a single row that says "every day".
 */
export function upcoming(events: ScheduleEvent[], today: string): AgendaRow[] {
  const rows: AgendaRow[] = []
  const laterPolls: ScheduleEvent[] = []

  for (const event of events) {
    if (event.day < today) continue
    if (event.state !== 'due' && event.state !== 'scheduled' && event.state !== 'running') continue
    if (event.kind === 'visibility_poll' && event.day > today) {
      laterPolls.push(event)
      continue
    }
    rows.push({ key: event.id, ...event })
  }

  const first = laterPolls[0]
  const last = laterPolls.at(-1)
  if (first && last) {
    rows.push({
      key: 'poll:daily',
      kind: 'visibility_poll',
      state: 'scheduled',
      day: first.day,
      ...(last.day !== first.day ? { dailyUntil: last.day } : {}),
      title: first.title,
      detail: first.detail,
      ...(first.href ? { href: first.href } : {}),
    })
  }

  return rows.sort((a, b) => a.day.localeCompare(b.day))
}

/** What has already happened in the window, newest first. */
export function recorded(events: ScheduleEvent[]): ScheduleEvent[] {
  return events
    .filter((event) => event.state === 'done' || event.state === 'failed')
    .sort((a, b) => b.day.localeCompare(a.day))
}

/** Append the site to an in-app path, so a link from the calendar keeps the site it was about. */
export function withSite(href: string, siteId: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}siteId=${siteId}`
}
