import type { Site } from '@seo/api-client'
import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { SubmitButton } from '@/components/ui/submit-button'
import { startAudit } from '../actions'
import { formatDay, hostOf } from '@/lib/format'

/** Statuses that mean an audit is on the queue or running, so "Run audit" should read differently. */
const RUNNING = new Set(['queued', 'crawling', 'evaluating'])

const AUDIT_STATE: Record<string, string> = {
  complete: 'Complete',
  failed: 'Failed',
  crawling: 'Reading pages',
  evaluating: 'Checking',
  queued: 'Waiting to start',
}

/**
 * Every site on the account, with the three things to do to one: set it up, read its last audit,
 * run another.
 *
 * Stacked on a phone. The actions are the point of the table and sit in its last column, which
 * is the one a sideways scroll hides.
 */
export function SitesTable({
  sites,
  activeId,
}: {
  sites: Site[]
  /** The site the overview above is showing. */
  activeId: string | undefined
}) {
  return (
    <DataTable
      label="Your sites"
      stack
      columns={[
        { header: 'Site', className: 'break-words' },
        { header: 'Last audit' },
        { header: 'Pages', align: 'end' },
        { header: 'Actions', hideHeader: true },
      ]}
      rows={sites.map((site) => {
        const running = Boolean(site.latestAudit && RUNNING.has(site.latestAudit.status))
        const host = hostOf(site.url)
        return {
          key: site.id,
          cells: [
            <span key="site">
              {host}
              {site.id === activeId && (
                <span className="text-muted ml-2 text-[12px]">(shown above)</span>
              )}
            </span>,
            <span key="audit" className="text-muted">
              {site.latestAudit
                ? `${AUDIT_STATE[site.latestAudit.status] ?? site.latestAudit.status}, ${formatDay(site.latestAudit.startedAt)}`
                : 'Never audited'}
            </span>,
            <span key="pages" className="tnum text-muted">
              {site.latestAudit?.pagesCrawled ?? (
                <>
                  <span aria-hidden="true">&ndash;</span>
                  <span className="sr-only">None yet</span>
                </>
              )}
            </span>,
            <div key="actions" className="flex flex-wrap items-center gap-3 md:justify-end">
              <Link href={`/site?siteId=${site.id}`}>
                Set up<span className="sr-only"> {host}</span>
              </Link>
              {site.latestAudit && (
                <Link href={`/audits/${site.latestAudit.id}?siteId=${site.id}`}>
                  {running ? 'View progress' : 'View audit'}
                  <span className="sr-only"> of {host}</span>
                </Link>
              )}
              <form action={startAudit}>
                <input type="hidden" name="siteId" value={site.id} />
                <SubmitButton
                  className="btn btn-secondary btn-sm"
                  pendingLabel="Queueing..."
                  disabled={running}
                >
                  {running ? 'Running...' : 'Run audit'}
                  <span className="sr-only"> of {host}</span>
                </SubmitButton>
              </form>
            </div>,
          ],
        }
      })}
    />
  )
}
