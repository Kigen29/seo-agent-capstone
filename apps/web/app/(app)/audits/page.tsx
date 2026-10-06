import type { AuditHistoryEntry } from '@seo/api-client'
import Link from 'next/link'
import { AXIS_LABEL } from '@/app/(app)/findings/labels'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * The audit history: every run of every site, newest first.
 *
 * An audit is a record of what was true on a day. A later audit never replaces it, and the point
 * of keeping them is to read them in order: what was found, what a fix resolved, what came back.
 * This page used to show only the newest audit per site, because that was all the API could
 * serve, which left the record in the database and nowhere a person could look.
 *
 * Each row carries what changed since the completed audit before it. That comparison is by
 * finding identity (ADR-0029), so "3 resolved" means three issues the earlier audit raised and
 * this one did not, not three fewer rows.
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

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId } = await searchParams

  let histories: { id: string; url: string; audits: AuditHistoryEntry[] }[]
  let siteCount: number
  try {
    const sites = await api.listSites()
    siteCount = sites.length
    const shown = siteId ? sites.filter((site) => site.id === siteId) : sites
    histories = await Promise.all(
      shown.map(async (site) => ({
        id: site.id,
        url: site.url,
        audits: await api.listSiteAudits(site.id),
      })),
    )
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const audited = histories.filter((history) => history.audits.length > 0)

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Audits"
        title="Audit history"
        description="Every audit of each site, newest first. Earlier audits are kept, so you can see what each one found and what changed since the one before."
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
          {siteCount === 0
            ? 'Add a site first, then run its first audit.'
            : 'These sites have never been audited. Run one from the sites list.'}
        </EmptyState>
      ) : (
        audited.map((history) => (
          <section key={history.id} className="mb-10" aria-label={hostOf(history.url)}>
            <h2 className="h-section mb-3">
              {hostOf(history.url)}{' '}
              <span className="text-muted text-sm font-normal">
                · {history.audits.length} audit{history.audits.length === 1 ? '' : 's'}
              </span>
            </h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Status</th>
                    <th>Pages</th>
                    <th>Findings</th>
                    <th>Since the audit before</th>
                    <th>Lowest areas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.audits.map((audit) => (
                    <tr key={audit.id}>
                      <td className="whitespace-nowrap">
                        {new Date(audit.startedAt).toLocaleString()}
                      </td>
                      <td>
                        <span className={STATUS_TONE[audit.status] ?? 'tag tag-neutral'}>
                          {audit.status}
                        </span>
                      </td>
                      <td className="tnum text-muted">{audit.pagesCrawled}</td>
                      <td className="tnum">{audit.status === 'complete' ? audit.findings : ''}</td>
                      <td className="whitespace-nowrap">
                        {audit.changes ? (
                          audit.changes.resolved === 0 && audit.changes.added === 0 ? (
                            <span className="text-muted">No change</span>
                          ) : (
                            <>
                              {audit.changes.resolved > 0 && (
                                <span className="tag tag-success mr-1">
                                  {audit.changes.resolved} resolved
                                </span>
                              )}
                              {audit.changes.added > 0 && (
                                <span className="tag tag-outline">{audit.changes.added} new</span>
                              )}
                            </>
                          )
                        ) : (
                          <span className="text-muted">
                            {audit.status === 'complete' ? 'First audit' : ''}
                          </span>
                        )}
                      </td>
                      <td className="text-muted text-[13px]">
                        {audit.status === 'complete' ? lowest(audit) : (audit.error ?? '')}
                      </td>
                      <td className="whitespace-nowrap">
                        <Link href={`/audits/${audit.id}`}>View &rarr;</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </main>
  )
}
