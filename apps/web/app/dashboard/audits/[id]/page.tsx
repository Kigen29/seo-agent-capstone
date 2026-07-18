import { priorityScore } from '@seo/core'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { LiveProgress } from '@/components/live-progress'
import { ScorecardGrid } from '@/components/scorecard'
import { SeverityBadge } from '@/components/severity'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

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
    <main className="wrap">
      <div className="card-kicker">Audit</div>
      <h1 style={{ fontWeight: 400, margin: 0 }}>{audit.siteUrl}</h1>
      <p style={{ marginTop: 'var(--space-1)', fontSize: 13, opacity: 0.6 }}>
        {audit.pagesCrawled} pages crawled &middot; {new Date(audit.startedAt).toLocaleString()}
      </p>

      <LiveProgress status={audit.status} pagesCrawled={audit.pagesCrawled} />

      {audit.status === 'failed' && (
        <div className="note note-error" style={{ marginTop: 'var(--space-6)' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>This audit failed</p>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 14 }}>{audit.error}</p>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 12, opacity: 0.75 }}>
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
            )}
          </section>
        </>
      )}
    </main>
  )
}
