import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * The audit history, which had no screen at all.
 *
 * Every audit but the most recent one was unreachable: the only route to an audit id was
 * `sites[].latestAudit.id` on the dashboard, or the redirect straight after queueing one. So the
 * record of what the agent had done over time existed in the database and nowhere a user could
 * look, which for a product whose argument is "we measure whether the fix worked" is the wrong
 * thing to hide.
 *
 * This lists the latest audit per site, which is what the API can serve today. The full
 * per-site history arrives with `GET /sites/:id/audits`.
 */
const STATUS_TONE: Record<string, string> = {
  complete: 'tag tag-success',
  failed: 'tag tag-critical',
  crawling: 'tag tag-accent',
  evaluating: 'tag tag-accent',
  queued: 'tag tag-neutral',
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId } = await searchParams

  let sites
  try {
    sites = await api.listSites()
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const shown = siteId ? sites.filter((site) => site.id === siteId) : sites
  const audited = shown.filter((site) => site.latestAudit)

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Audits"
        title="What we have run"
        description="The most recent audit for each site. Open one to see its eight-axis scorecard and the findings it produced."
      />

      {audited.length === 0 ? (
        <EmptyState
          figure="0"
          title="Nothing audited yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Run an audit
            </Link>
          }
        >
          {sites.length === 0
            ? 'Add a site first, then run its first audit.'
            : 'These sites have never been audited. Run one from the sites list.'}
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Status</th>
                <th>Pages</th>
                <th>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {audited.map((site) => {
                const audit = site.latestAudit!
                return (
                  <tr key={site.id}>
                    <td>{hostOf(site.url)}</td>
                    <td>
                      <span className={STATUS_TONE[audit.status] ?? 'tag tag-neutral'}>
                        {audit.status}
                      </span>
                    </td>
                    <td className="tnum text-muted">{audit.pagesCrawled}</td>
                    <td className="text-muted">{new Date(audit.startedAt).toLocaleString()}</td>
                    <td className="whitespace-nowrap">
                      <Link href={`/audits/${audit.id}`}>View &rarr;</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
