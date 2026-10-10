import type { ScheduleEvent } from '@seo/api-client'
import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { formatUtcDay } from '@/lib/format'
import { KIND, STATE, withSite, type AgendaRow } from '@/lib/schedule-view'

/**
 * The two lists under the calendar: what is coming, and what has run.
 *
 * They hold the same events the grid does, as rows. On a phone they are the whole page, because
 * a seven-column grid does not fit one; on a wide screen they are where the detail is, since a
 * calendar cell has room for a label and nothing else.
 */

function State({ state }: { state: ScheduleEvent['state'] }) {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">{STATE[state].mark} </span>
      {STATE[state].label}
    </span>
  )
}

function What({
  title,
  detail,
  href,
  siteId,
}: {
  title: string
  detail: string
  href?: string | undefined
  siteId: string
}) {
  return (
    <div className="max-w-[64ch]">
      <div className="font-semibold">
        {href ? <Link href={withSite(href, siteId)}>{title}</Link> : title}
      </div>
      <div className="text-muted text-[13px]">{detail}</div>
    </div>
  )
}

export function UpcomingTable({ rows, siteId }: { rows: AgendaRow[]; siteId: string }) {
  return (
    <DataTable
      label="What is coming up"
      stack
      columns={[
        { header: 'When', className: 'whitespace-nowrap' },
        { header: 'Kind' },
        { header: 'What will run' },
        { header: 'Status', className: 'whitespace-nowrap' },
      ]}
      rows={rows.map((row) => ({
        key: row.key,
        cells: [
          row.dailyUntil ? (
            <span key="when">
              Every day, {formatUtcDay(row.day)} to {formatUtcDay(row.dailyUntil)}
            </span>
          ) : (
            formatUtcDay(row.day)
          ),
          <span key="kind" className={KIND[row.kind].className}>
            {KIND[row.kind].label}
          </span>,
          <What key="what" title={row.title} detail={row.detail} href={row.href} siteId={siteId} />,
          <State key="state" state={row.state} />,
        ],
      }))}
    />
  )
}

export function RecordedTable({ events, siteId }: { events: ScheduleEvent[]; siteId: string }) {
  return (
    <DataTable
      label="What has already run"
      stack
      columns={[
        { header: 'When', className: 'whitespace-nowrap' },
        { header: 'Kind' },
        { header: 'What ran' },
        { header: 'Result', className: 'whitespace-nowrap' },
      ]}
      rows={events.map((event) => ({
        key: event.id,
        cells: [
          formatUtcDay(event.day),
          <span key="kind" className={KIND[event.kind].className}>
            {KIND[event.kind].label}
          </span>,
          <What
            key="what"
            title={event.title}
            detail={event.detail}
            href={event.href}
            siteId={siteId}
          />,
          <State key="state" state={event.state} />,
        ],
      }))}
    />
  )
}
