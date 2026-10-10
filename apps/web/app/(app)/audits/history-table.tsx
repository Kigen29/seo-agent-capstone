import type { AuditHistoryEntry } from '@seo/api-client'
import Link from 'next/link'
import { AXIS_LABEL } from '@/app/(app)/findings/labels'
import { DataTable } from '@/components/ui/data-table'
import { formatDayTime } from '@/lib/format'

/**
 * One site's audits, newest first, a page at a time.
 *
 * Each row carries what changed since the completed audit before it. That comparison is by
 * finding identity (ADR-0029), so "3 resolved" means three issues the earlier audit raised and
 * this one did not, not three fewer rows.
 */

const STATUS: Record<string, { label: string; className: string }> = {
  complete: { label: 'Complete', className: 'tag tag-dot tag-success' },
  failed: { label: 'Failed', className: 'tag tag-dot tag-critical' },
  crawling: { label: 'Reading pages', className: 'tag tag-dot tag-accent' },
  evaluating: { label: 'Checking', className: 'tag tag-dot tag-accent' },
  queued: { label: 'Waiting to start', className: 'tag tag-dot tag-neutral' },
}

/** The measured axes at their lowest, which is where a reader's eye should go. */
function lowest(entry: AuditHistoryEntry): string {
  const measured = entry.scores
    .filter((point): point is { axis: typeof point.axis; score: number } => point.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
  if (measured.length === 0) return 'Not scored'
  return measured
    .map((point) => `${AXIS_LABEL[point.axis] ?? point.axis} ${Math.round(point.score)}`)
    .join(' · ')
}

function Changes({ audit }: { audit: AuditHistoryEntry }) {
  if (!audit.changes) {
    return <span className="text-muted">{audit.status === 'complete' ? 'First audit' : ''}</span>
  }
  if (audit.changes.resolved === 0 && audit.changes.added === 0) {
    return <span className="text-muted">No change</span>
  }
  return (
    <>
      {audit.changes.resolved > 0 && (
        <span className="tag tag-success mr-1">{audit.changes.resolved} resolved</span>
      )}
      {audit.changes.added > 0 && (
        <span className="tag tag-outline">{audit.changes.added} new</span>
      )}
    </>
  )
}

export function HistoryTable({ site, audits }: { site: string; audits: AuditHistoryEntry[] }) {
  return (
    <DataTable
      label={`Audits of ${site}`}
      columns={[
        { header: 'Run', className: 'whitespace-nowrap' },
        { header: 'Status' },
        { header: 'Pages', align: 'end' },
        { header: 'Findings', align: 'end' },
        { header: 'Since the audit before', className: 'whitespace-nowrap' },
        { header: 'Lowest areas' },
        { header: 'Open', hideHeader: true, align: 'end', className: 'whitespace-nowrap' },
      ]}
      rows={audits.map((audit) => ({
        key: audit.id,
        cells: [
          formatDayTime(audit.startedAt),
          <span key="status" className={STATUS[audit.status]?.className ?? 'tag tag-neutral'}>
            {STATUS[audit.status]?.label ?? audit.status}
          </span>,
          <span key="pages" className="tnum text-muted">
            {audit.pagesCrawled}
          </span>,
          <span key="findings" className="tnum">
            {audit.status === 'complete' ? audit.findings : ''}
          </span>,
          <Changes key="changes" audit={audit} />,
          <span key="lowest" className="text-muted text-[13px]">
            {audit.status === 'complete' ? lowest(audit) : (audit.error ?? '')}
          </span>,
          <Link key="open" href={`/audits/${audit.id}`}>
            View
            <span className="sr-only"> the audit of {formatDayTime(audit.startedAt)}</span> &rarr;
          </Link>,
        ],
      }))}
    />
  )
}
