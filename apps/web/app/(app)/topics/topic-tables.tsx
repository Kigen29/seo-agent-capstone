import type { FindingListItem } from '@seo/api-client'
import Link from 'next/link'
import { STATUS_LABEL } from '@/app/(app)/findings/labels'
import { DataTable } from '@/components/ui/data-table'
import { OutboundLink, pathOf } from '@/components/ui/outbound-link'

/**
 * The two tables on the topics page: what the map suggests, and what is in each group.
 *
 * Kept out of the page file so the page is what is fetched and what is said when there is
 * nothing, and this is the rows.
 */

/** A group of pages the audit judged to be about one subject. */
export interface TopicGroup {
  name: string
  /** 0..1, of the pages that were compared. */
  share: number
  pages: string[]
}

/** The findings the topic checks raised, each a link to the finding itself. */
export function AdviceTable({ advice }: { advice: FindingListItem[] }) {
  return (
    <DataTable
      label="What the topic map suggests"
      columns={[
        { header: 'Check' },
        { header: 'What it found' },
        { header: 'Status', align: 'end' },
      ]}
      rows={advice.map((finding) => ({
        key: finding.rowId,
        cells: [
          <span key="rule" className="rule-id">
            {finding.ruleId}
          </span>,
          <Link key="title" href={`/findings/${finding.rowId}?siteId=${finding.siteId}`}>
            {finding.title}
          </Link>,
          <span key="status" className={STATUS_LABEL[finding.status].className}>
            {STATUS_LABEL[finding.status].label}
          </span>,
        ],
      }))}
    />
  )
}

/**
 * Each group, how much of the site it is, and its pages on request.
 *
 * The pages stay behind a disclosure in their own cell. They are the evidence for the grouping,
 * which a reader checks for one group at a time, and forty addresses per row shown at once would
 * bury the column that says what the groups are.
 */
export function GroupsTable({ groups }: { groups: TopicGroup[] }) {
  return (
    <DataTable
      label="Topic groups and their pages"
      columns={[
        { header: 'Group' },
        { header: 'Pages in it' },
        { header: 'Share of pages compared', align: 'end' },
      ]}
      rows={groups.map((group, index) => ({
        // A model names the groups, and two can be given the same name.
        key: `${group.name}-${index}`,
        cells: [
          <span key="name" className="font-semibold">
            {group.name}
          </span>,
          <details key="pages">
            <summary className="cursor-pointer">
              {group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'}
            </summary>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {group.pages.map((url) => (
                <li key={url} className="min-w-0">
                  <OutboundLink href={url} className="rule-id m-0">
                    {pathOf(url)}
                  </OutboundLink>
                </li>
              ))}
            </ul>
          </details>,
          <span key="share" className="tnum">
            {Math.round(group.share * 100)}%
          </span>,
        ],
      }))}
    />
  )
}
