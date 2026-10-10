import type { EarlierWork, FindingListItem } from '@seo/api-client'
import Link from 'next/link'
import { SeverityBadge } from '@/components/severity'
import { hostOf, plural } from '@/lib/format'
import { Legend } from '@/components/ui/legend'
import { MANUAL_REASON, manualReasonFor } from '@/lib/manual-reason'
import { AXIS_LABEL, STATUS_LABEL } from './labels'

/**
 * One page of the findings inbox, drawn twice: as cards on a phone and as a table from `md` up.
 *
 * This is the one list that is not a `<DataTable>`, and the reason is the address bar. The inbox
 * is filtered, sorted and paged by the server, so that a filter is one page of rows and not the
 * whole backlog, and so that a filtered view is a link somebody can send. Its headers are links
 * and its paging is `<Pagination>`, which the page file puts under whichever of these is showing.
 */

/** Columns the table offers to sort by, and what each is called in the header. */
export const SORTS = [
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'title', label: 'Finding' },
  { key: 'axis', label: 'Area' },
] as const

export type SortKey = (typeof SORTS)[number]['key']

/** The inbox on a phone: one card a finding, with the whole title and what happens next. */
export function FindingCards({ findings }: { findings: FindingListItem[] }) {
  return (
    <div className="grid gap-3 md:hidden">
      {findings.map((finding) => (
        <article key={finding.rowId} className="card elev-sm">
          <div className="flex flex-wrap gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className={STATUS_LABEL[finding.status].className}>
              {STATUS_LABEL[finding.status].label}
            </span>
          </div>
          <h2 className="m-0 text-lg break-words">
            <Link href={`/findings/${finding.rowId}?siteId=${finding.siteId}`}>
              {finding.title}
            </Link>
          </h2>
          <p className="text-muted m-0 text-sm break-words">
            {hostOf(finding.siteUrl)} / {AXIS_LABEL[finding.axis]} /{' '}
            {plural(finding.affectedUrlCount, 'page')}
          </p>
          <p className="m-0 text-sm">
            {finding.fixFailed
              ? 'Last attempt failed. Open for details.'
              : finding.fixable
                ? 'The agent can open a pull request for this.'
                : manualReasonFor(finding).label}
          </p>
        </article>
      ))}
    </div>
  )
}

/** The inbox from `md` up. Each sortable header is a link to the same view in that order. */
export function FindingsTable({
  findings,
  sort,
  showSite,
  sortHref,
}: {
  findings: FindingListItem[]
  sort: string
  /** A site column, when the view spans more than one site. */
  showSite: boolean
  sortHref: (key: SortKey) => string
}) {
  return (
    <div className="table-scroll hidden md:block">
      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            {SORTS.filter((column) => column.key !== 'priority').map((column) => (
              <th key={column.key} aria-sort={sort === column.key ? 'descending' : 'none'}>
                {/*
                  Sortable headers, which this table did not have: the order was fixed by
                  priority score with no way to ask for anything else.
                */}
                <SortLink
                  href={sortHref(column.key)}
                  active={sort === column.key}
                  label={column.label}
                />
              </th>
            ))}
            {showSite && <th>Site</th>}
            <th>Status</th>
            <th aria-sort={sort === 'priority' ? 'descending' : 'none'}>
              <SortLink href={sortHref('priority')} active={sort === 'priority'} label="Priority" />
            </th>
            <th>Pages</th>
            <th className="num">Action</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => {
            const status = STATUS_LABEL[finding.status]
            return (
              <tr key={finding.rowId}>
                <td>
                  {/* Plain status chips: the outline style read as a button nobody could press. */}
                  {finding.fixable ? (
                    <span className="tag tag-success">Agent can fix</span>
                  ) : (
                    // Says why there is no pull request, instead of only that there is none.
                    <span className="tag tag-neutral">{manualReasonFor(finding).label}</span>
                  )}
                </td>
                <td>
                  <SeverityBadge severity={finding.severity} />
                </td>
                <td>
                  <span className="rule-id">{finding.ruleId}</span>
                  <Link href={`/findings/${finding.rowId}?siteId=${finding.siteId}`}>
                    {finding.title}
                  </Link>
                </td>
                <td>{AXIS_LABEL[finding.axis] ?? finding.axis}</td>
                {showSite && <td className="text-muted">{hostOf(finding.siteUrl)}</td>}
                {/* Tags wrap inside the cell: three on one line pushed Priority, Pages and the
                    action out of the frame at 1440px. */}
                <td>
                  <div className="flex flex-wrap gap-1">
                    {/*
                    Status was fetched and never rendered, so a finding with a pull request
                    already open looked exactly like one nobody had touched. In a triage
                    list that is the difference between work to do and work in flight.
                  */}
                    <span className={status.className}>{status.label}</span>
                    {/*
                    A failed fix attempt leaves the finding open, which is correct: it
                    still needs doing. But "open" alone made a finding whose fix had been
                    tried and failed identical to one nobody had touched, which is the
                    same mistake as not rendering status at all, one level down.
                  */}
                    {finding.fixFailed && <span className="tag tag-critical">Fix failed</span>}
                    {/*
                    The same issue from an earlier audit. Without this, a finding whose
                    fix is already open as a pull request reads as untouched after the
                    next audit, and one that was fixed and came back reads as brand new.
                  */}
                    {finding.earlier && (
                      <span className={EARLIER_TAG[finding.earlier.work].className}>
                        {EARLIER_TAG[finding.earlier.work].label}
                      </span>
                    )}
                  </div>
                </td>
                <td className="tnum text-muted">{finding.estimatedImpact}</td>
                <td className="tnum text-muted">{finding.affectedUrlCount}</td>
                <td className="num whitespace-nowrap">
                  <Link href={`/findings/${finding.rowId}?siteId=${finding.siteId}`}>
                    View &rarr;
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A column header that is also the control for sorting by it. */
function SortLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      style={{ color: active ? 'var(--color-accent-700)' : 'inherit' }}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active ? ' ↓' : ''}
    </Link>
  )
}

/** How earlier work on the same issue is named on an inbox row. */
const EARLIER_TAG: Record<EarlierWork['work'], { label: string; className: string; what: string }> =
  {
    in_progress: {
      label: 'Fix in progress',
      className: 'tag tag-success',
      what: 'A pull request for this issue was opened from an earlier audit.',
    },
    regressed: {
      label: 'Back after a fix',
      className: 'tag tag-critical',
      what: 'This was fixed and verified before, and has returned.',
    },
    fix_failed: {
      label: 'Earlier fix did not work',
      className: 'tag tag-neutral',
      what: 'A merged fix for this issue was checked and did not resolve it.',
    },
  }

/**
 * What the tags in the inbox mean, said once under it.
 *
 * Each of these used to be a `title` on its tag, which a mouse can read and nothing else can:
 * not a keyboard, not a screen reader, not a finger. Why a finding has no pull request is the
 * question the Type column raises on every row, so the answer is on the page.
 */
export function FindingsLegend() {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[13px]">What the tags mean</summary>
      <Legend
        className="mt-2"
        items={[
          {
            term: 'Agent can fix',
            meaning: 'The agent can open a pull request for this. You review and merge it.',
          },
          ...Object.values(MANUAL_REASON).map((reason) => ({
            term: reason.label,
            meaning: reason.why,
          })),
          {
            term: 'Fix failed',
            meaning: 'The last attempt to fix this failed. Open the finding for the reason.',
          },
          ...Object.values(EARLIER_TAG).map((tag) => ({ term: tag.label, meaning: tag.what })),
        ]}
      />
    </details>
  )
}
