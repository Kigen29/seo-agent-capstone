import type { AuditHistoryEntry } from '@seo/api-client'
import Link from 'next/link'
import { AXIS_LABEL } from '@/app/(app)/findings/labels'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { HistoryTable } from './history-table'

export const dynamic = 'force-dynamic'

/**
 * The audit history: every run of every site, newest first.
 *
 * An audit is a record of what was true on a day. A later audit never replaces it, and the point
 * of keeping them is to read them in order: what was found, what a fix resolved, what came back.
 * This page used to show only the newest audit per site, because that was all the API could
 * serve, which left the record in the database and nowhere a person could look.
 */

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

/**
 * The eight axes of a site's latest completed audit, as tiles.
 *
 * Eight separate figures and never a total: the axes move independently, and one number would hide
 * which of them moved. An axis that was not measured shows a dash and says so, because a zero
 * there would read as a failing score.
 */
function LatestScorecard({ entry }: { entry: AuditHistoryEntry }) {
  return (
    <div className="card mt-4" style={{ padding: 'var(--space-5)', gap: 'var(--space-4)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="card-heading">Latest scorecard</h3>
          <div className="text-muted mt-1 text-[13px]">
            Eight areas, each scored on its own, from the audit of{' '}
            {day.format(new Date(entry.startedAt))}.
          </div>
        </div>
        <Link href={`/audits/${entry.id}`} className="shrink-0 text-[13px]">
          Open this audit &rarr;
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {entry.scores.map((point) => (
          <div
            key={point.axis}
            className="rounded-lg border p-3"
            style={{ borderColor: 'var(--color-divider)', background: 'var(--color-surface)' }}
          >
            <div className="stat-label">{AXIS_LABEL[point.axis] ?? point.axis}</div>
            <div className="stat-value stat-value-sm">
              {point.score === null ? (
                <span className="text-subtle">
                  &mdash;<span className="sr-only">Not measured</span>
                </span>
              ) : (
                Math.round(point.score)
              )}
            </div>
            {point.score === null && <div className="stat-hint">Not measured</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Newest first, so the first completed entry is the latest one with scores to show. */
const latestComplete = (audits: AuditHistoryEntry[]) =>
  audits.find((audit) => audit.status === 'complete')

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
            <HistoryTable site={hostOf(history.url)} audits={history.audits} />
            {latestComplete(history.audits) && (
              <LatestScorecard entry={latestComplete(history.audits)!} />
            )}
          </section>
        ))
      )}
    </main>
  )
}
