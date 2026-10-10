import type { Site, SiteSchedule } from '@seo/api-client'
import { monthWindow, shiftMonth } from '@seo/core'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Legend } from '@/components/ui/legend'
import { MonthCalendar, type CalendarEntry } from '@/components/ui/month-calendar'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { formatMonth, hostOf } from '@/lib/format'
import { byDay, KIND, recorded, STATE, upcoming, withSite } from '@/lib/schedule-view'
import { getClient } from '@/lib/session'
import { siteUrl } from '@/lib/site'
import { AuditCadenceControl } from './audit-cadence'
import { RecordedTable, UpcomingTable } from './schedule-tables'

export const dynamic = 'force-dynamic'

/**
 * The schedule: what runs for a site, on which day, and what became of it (ADR-0044).
 *
 * Until this page the product did things on a timer that nobody could see. Answers were checked
 * every day, competitors were read every week, a fix had its traffic looked up a month after it
 * shipped, and the only evidence was a result turning up on some other page. A person could not
 * tell whether today's check had run, when the next reading was, or whether anything was
 * scheduled at all.
 *
 * Nothing shown here is stored as a schedule. The worker decides what is due by asking the
 * database each time it wakes, and this page asks the same questions, so it cannot promise a run
 * the worker would not make.
 *
 * No `loading.tsx` on this route, on purpose: with one, a page does not reliably redraw in place
 * after a server action, and the control at the top of this page depends on exactly that
 * (see docs/state-of-play.md, traps).
 */
export const metadata = { title: 'Schedule' }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; month?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId, month: asked } = await searchParams
  const month = asked && MONTH.test(asked) ? asked : undefined

  let site: Site | undefined
  let schedule: SiteSchedule | undefined
  let outOfRange = false
  try {
    const sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site) {
      try {
        schedule = await api.getSchedule(site.id, month)
      } catch (error) {
        // A month too far away is a bad address, not a broken page: show this month and say so.
        if ((error as { status?: number }).status !== 400) throw error
        outOfRange = true
        schedule = await api.getSchedule(site.id)
      }
    }
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (!site || !schedule) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="This site" title="Schedule" />
        <EmptyState
          figure="0"
          title="No site yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Add a site
            </Link>
          }
        >
          Add a site, and what runs for it and when is shown here.
        </EmptyState>
      </main>
    )
  }

  const window = monthWindow(schedule.month)
  const coming = upcoming(schedule.events, schedule.today)
  const ran = recorded(schedule.events)
  const thisMonth = schedule.today.slice(0, 7)
  const monthHref = (target: string) =>
    `/schedule?siteId=${site.id}${target === thisMonth ? '' : `&month=${target}`}`

  const entries = new Map<string, CalendarEntry[]>()
  for (const [day, events] of byDay(schedule.events)) {
    entries.set(
      day,
      events.map((event) => ({
        key: event.id,
        node: (
          <Link
            href={withSite(event.href ?? '/schedule', site.id)}
            className={`month-entry ${KIND[event.kind].className}`}
            title={event.title}
          >
            <span aria-hidden="true">{STATE[event.state].mark}</span>
            <span className="truncate">
              {event.kind === 'competitor_read'
                ? event.title.replace(/^Read /, '')
                : KIND[event.kind].short}
            </span>
            <span className="sr-only">
              , {event.title}, {STATE[event.state].label}
            </span>
          </Link>
        ),
      })),
    )
  }

  const nothingScheduled = schedule.events.length === 0

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="This site"
        title="What runs, and when"
        description={`Everything the agent does for ${hostOf(site.url)} on a timer: audits, the daily check of AI answers, the weekly reading of each competitor, and the traffic comparison after a fix. Past days show what ran. Days ahead show what is due.`}
        actions={
          <a
            href={`/schedule/calendar.ics?siteId=${site.id}&month=${schedule.month}`}
            className="btn btn-secondary"
            download
          >
            Download calendar file
          </a>
        }
      />

      <section className="mb-8" aria-labelledby="cadence-heading">
        <h2 id="cadence-heading" className="h-section mb-3">
          Scheduled audits
        </h2>
        <AuditCadenceControl siteId={site.id} cadence={schedule.auditCadence} />
      </section>

      {outOfRange && (
        <Note tone="info" className="mb-4">
          The calendar covers twelve months either side of this one, so this month is shown.
        </Note>
      )}

      <section className="mb-8" aria-labelledby="month-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="month-heading" className="h-section m-0">
            {formatMonth(schedule.month)}
          </h2>
          <nav aria-label="Months" className="flex flex-wrap items-center gap-1">
            <Link href={monthHref(shiftMonth(schedule.month, -1))} className="btn btn-ghost btn-sm">
              &larr; {formatMonth(shiftMonth(schedule.month, -1))}
            </Link>
            {schedule.month !== thisMonth && (
              <Link href={monthHref(thisMonth)} className="btn btn-secondary btn-sm">
                This month
              </Link>
            )}
            <Link href={monthHref(shiftMonth(schedule.month, 1))} className="btn btn-ghost btn-sm">
              {formatMonth(shiftMonth(schedule.month, 1))} &rarr;
            </Link>
          </nav>
        </div>

        {nothingScheduled ? (
          <EmptyState
            figure="0"
            title="Nothing ran or is due in these weeks"
            action={
              <Link href={`/site?siteId=${site.id}`} className="btn btn-primary">
                Finish site setup
              </Link>
            }
          >
            Turn on scheduled audits above, track a question on AI visibility, or name a competitor,
            and each one appears here on the day it runs.
          </EmptyState>
        ) : (
          <>
            {/* The grid from md up. On a phone the two lists below are the page. */}
            <div className="hidden md:block">
              <MonthCalendar
                label={`What runs for ${hostOf(site.url)} in ${formatMonth(schedule.month)}`}
                month={schedule.month}
                days={window.days}
                today={schedule.today}
                entries={entries}
              />
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <Legend
                items={Object.values(KIND).map((kind) => ({
                  term: <span className={kind.className}>{kind.label}</span>,
                  meaning: kind.what,
                }))}
              />
              <Legend
                items={Object.values(STATE).map((state) => ({
                  term: (
                    <>
                      <span aria-hidden="true">{state.mark} </span>
                      {state.label}
                    </>
                  ),
                  meaning: state.what,
                }))}
              />
            </div>
          </>
        )}
      </section>

      {coming.length > 0 && (
        <section className="mb-8" aria-labelledby="coming-heading">
          <h2 id="coming-heading" className="h-section mb-1">
            Coming up
          </h2>
          <div className="text-muted mb-3 max-w-[68ch] text-sm">
            From today to the end of the weeks shown. Days are counted in UTC, and a run happens at
            some point during its day, not at a set hour: the worker wakes several times an hour and
            does whatever is due. Each row can be put in Google Calendar with one press, and the
            button at the top of the page downloads all of them for any other calendar.
          </div>
          <UpcomingTable rows={coming} siteId={site.id} site={hostOf(site.url)} origin={siteUrl} />
        </section>
      )}

      {ran.length > 0 && (
        <section aria-labelledby="ran-heading">
          <h2 id="ran-heading" className="h-section mb-3">
            Already run
          </h2>
          <RecordedTable events={ran} siteId={site.id} />
        </section>
      )}
    </main>
  )
}
