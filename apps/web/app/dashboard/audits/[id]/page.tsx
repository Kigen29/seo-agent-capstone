import { priorityScore } from '@seo/core'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { LiveProgress } from '@/components/live-progress'
import { ScorecardGrid } from '@/components/scorecard'
import { SeverityBadge } from '@/components/severity'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

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

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const api = await getClient()
  if (!api) return null

  let audit
  try {
    audit = await api.getAudit(id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const findings = [...audit.findings].sort((a, b) => priorityScore(b) - priorityScore(a))

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Audit"
        title={audit.siteUrl}
        description={`${audit.pagesCrawled} pages crawled · ${new Date(audit.startedAt).toLocaleString()}`}
        actions={
          <Link href="/findings" className="btn btn-secondary btn-sm">
            All findings
          </Link>
        }
      />

      <LiveProgress auditId={audit.id} status={audit.status} pagesCrawled={audit.pagesCrawled} />

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
            <h4 style={{ marginBottom: 'var(--space-2)' }}>Eight-axis scorecard</h4>
            <p
              style={{
                marginBottom: 'var(--space-4)',
                fontSize: 14,
                opacity: 0.75,
                maxWidth: '64ch',
              }}
            >
              Eight scores, never one. They move independently, and a single number would hide
              everything. A dash means we have not measured it, which is not the same as a pass.
            </p>

            <ScorecardGrid scorecard={audit.scorecard} />
          </section>

          <section style={{ marginTop: 'var(--space-8)' }}>
            <h4 style={{ marginBottom: 'var(--space-2)' }}>Findings</h4>
            <p
              style={{
                marginBottom: 'var(--space-4)',
                fontSize: 14,
                opacity: 0.75,
                maxWidth: '64ch',
              }}
            >
              Ordered by severity multiplied by confidence and impact, divided by effort. The useful
              question is not what is wrong, it is which three things to do on Monday.
            </p>

            {findings.length === 0 ? (
              <p className="note note-ok">Nothing to report. Every check we ran passed.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Finding</th>
                      <th>Severity</th>
                      <th>Effort</th>
                      <th>Impact</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((finding) => (
                      <tr key={finding.rowId}>
                        <td>
                          <div>{finding.title}</div>
                          <div style={{ fontSize: 12, opacity: 0.55 }}>
                            {finding.ruleId} &middot; {finding.affectedUrls.length}{' '}
                            {finding.affectedUrls.length === 1 ? 'page' : 'pages'}
                            {finding.fixable && (
                              <span style={{ color: 'var(--color-accent-700)' }}>
                                {' '}
                                &middot; we can write the fix
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <SeverityBadge severity={finding.severity} />
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{finding.estimatedEffort}</td>
                        <td className="tnum">{finding.estimatedImpact}/100</td>
                        <td>
                          <Link href={`/dashboard/findings/${finding.rowId}`}>View &rarr;</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
