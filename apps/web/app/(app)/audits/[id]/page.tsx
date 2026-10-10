import Link from 'next/link'
import { redirect } from 'next/navigation'
import { openFixPrs } from '@/app/(app)/findings/actions'
import { BULK_FIX_LIMIT } from '@/app/(app)/findings/bulk-fix'
import { ApiAsleep } from '@/components/api-asleep'
import { SubmitButton } from '@/components/ui/submit-button'
import { AuditChangesSection } from '@/components/audit-changes'
import { LiveProgress } from '@/components/live-progress'
import { ScorecardGrid } from '@/components/scorecard'
import { TopicMapFigure } from '@/components/topic-map'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { formatDayTime, hostOf, plural } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Deliberately no `loading.tsx` on this route, and it is worth knowing why before adding one.
 *
 * A `loading.tsx` wraps the route in a Suspense boundary, which makes Next stream the response:
 * the shell goes out with HTTP 200 the moment the boundary renders, and a status code cannot be
 * changed after the headers have flushed. This page calls `notFound()` for an audit belonging to
 * another tenant, and that 404 is not cosmetic: ADR-0009 refuses to distinguish "does not exist"
 * from "is not yours" precisely so nobody can enumerate audit ids across the platform, and the
 * e2e suite asserts the status. Adding a skeleton here silently downgraded that to a 200.
 *
 * The list routes (`/dashboard`, `/findings`) cannot 404, so they keep their skeletons. Here the
 * cold-start case is covered by `<ApiAsleep />` instead.
 */

export const metadata = { title: 'Audit' }

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const { id } = await params
  const { siteId } = await searchParams
  const api = await getClient()
  if (!api) return null

  let audit
  try {
    audit = await api.getAudit(id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (siteId !== audit.siteId) redirect(`/audits/${id}?siteId=${audit.siteId}`)

  const fixableCount = audit.findings.filter((finding) => finding.fixable).length
  const openFixable = audit.findings.filter(
    (finding) => finding.fixable && finding.status === 'open',
  ).length

  // The comparison is extra. If it cannot be read the audit is still shown, without it.
  const changes = await api.getAuditChanges(id).catch(() => null)

  return (
    <main id="main" className="wrap">
      <Breadcrumbs
        trail={[
          { label: 'Audits', href: `/audits?siteId=${audit.siteId}` },
          { label: hostOf(audit.siteUrl) },
        ]}
      />
      <PageHeader
        kicker="Audit"
        title={hostOf(audit.siteUrl)}
        description={`${plural(audit.pagesCrawled, 'page')} read · ${formatDayTime(audit.startedAt)}`}
        actions={
          <>
            <Link href={`/audits?siteId=${audit.siteId}`} className="btn btn-secondary btn-sm">
              Audit history
            </Link>
            <Link href={`/findings?siteId=${audit.siteId}`} className="btn btn-secondary btn-sm">
              All findings
            </Link>
          </>
        }
      />

      <LiveProgress
        auditId={audit.id}
        startedAt={audit.startedAt}
        status={audit.status}
        pagesCrawled={audit.pagesCrawled}
      />

      {audit.status === 'failed' && (
        <div className="note note-error mt-6">
          <p className="m-0 font-semibold">This audit failed</p>
          <p className="mt-2 mb-0 text-sm">{audit.error}</p>
          <p className="mt-2 mb-0 text-xs opacity-80">
            Nothing was scored. We do not publish a scorecard for a site we could not reach: no data
            is not the same as no problems.
          </p>
        </div>
      )}

      {audit.scorecard && (
        <>
          <section style={{ marginTop: 'var(--space-8)' }}>
            <h2 className="h-section" style={{ marginBottom: 'var(--space-2)' }}>
              Scorecard
            </h2>
            <p
              style={{
                marginBottom: 'var(--space-4)',
                fontSize: 14,
                opacity: 0.75,
                maxWidth: '64ch',
              }}
            >
              Eight areas, each scored on its own. A dash means not measured yet, which is not the
              same as a pass.
            </p>

            <ScorecardGrid scorecard={audit.scorecard} />
          </section>

          {changes && <AuditChangesSection changes={changes} />}

          {audit.metrics?.topics && audit.metrics.topics.clusters.length > 0 && (
            <section style={{ marginTop: 'var(--space-8)' }}>
              <h2 className="h-section" style={{ marginBottom: 'var(--space-2)' }}>
                What this site is about
              </h2>
              <p
                style={{
                  marginBottom: 'var(--space-4)',
                  fontSize: 14,
                  opacity: 0.75,
                  maxWidth: '64ch',
                }}
              >
                Pages grouped by how close they are in meaning, then labelled. Useful for the
                question a finding cannot answer: whether the site is mostly about the thing you
                want to be found for.
              </p>

              <TopicMapFigure map={audit.metrics.topics} />
            </section>
          )}

          {/*
            The findings themselves live in the inbox, where they can be filtered, sorted and
            acted on. Listing them here as well made this page a second, worse copy of that one.
            What belongs on an audit is how many there are and how many the agent can take.
          */}
          <section style={{ marginTop: 'var(--space-8)' }}>
            <h2 className="h-section" style={{ marginBottom: 'var(--space-2)' }}>
              What to do next
            </h2>
            {audit.findings.length === 0 ? (
              <p className="note note-ok">Nothing to report. Every check we ran passed.</p>
            ) : (
              <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
                <p className="m-0">
                  This audit raised <strong>{audit.findings.length}</strong>{' '}
                  {audit.findings.length === 1 ? 'finding' : 'findings'}. The agent can open a pull
                  request for <strong>{fixableCount}</strong> of them.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/findings?siteId=${audit.siteId}&fixable=true`}
                    className="btn btn-primary btn-sm"
                  >
                    Review what the agent can fix
                  </Link>
                  {openFixable > 0 && (
                    <form action={openFixPrs}>
                      <input type="hidden" name="siteId" value={audit.siteId} />
                      <SubmitButton
                        pendingLabel="Asking the agent..."
                        className="btn btn-secondary btn-sm"
                      >
                        Open {Math.min(openFixable, BULK_FIX_LIMIT)} pull{' '}
                        {Math.min(openFixable, BULK_FIX_LIMIT) === 1 ? 'request' : 'requests'} now
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
