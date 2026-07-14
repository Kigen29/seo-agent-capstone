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
    <main className="mt-10">
      <h1 className="text-2xl font-semibold text-neutral-50">{audit.siteUrl}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {audit.pagesCrawled} pages crawled &middot; {new Date(audit.startedAt).toLocaleString()}
      </p>

      <LiveProgress status={audit.status} pagesCrawled={audit.pagesCrawled} />

      {audit.status === 'failed' && (
        <div className="mt-6 rounded-lg border border-red-900 bg-red-950/40 p-4">
          <p className="text-sm font-medium text-red-300">This audit failed</p>
          <p className="mt-2 text-sm leading-relaxed text-red-200/80">{audit.error}</p>
          <p className="mt-2 text-xs leading-relaxed text-red-200/50">
            Nothing was scored. We do not publish a scorecard for a site we could not reach: no data
            is not the same as no problems.
          </p>
        </div>
      )}

      {audit.scorecard && (
        <>
          <section className="mt-10">
            <h2 className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
              The eight axes
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              Eight scores, never one. They move independently, and a single number would hide
              everything. A dash means we have not measured it, which is not the same as a pass.
            </p>

            <div className="mt-6">
              <ScorecardGrid scorecard={audit.scorecard} />
            </div>
          </section>

          <section className="mt-12">
            <h2 className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
              Findings
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              Ordered by severity multiplied by confidence and impact, divided by effort. The useful
              question is not what is wrong, it is which three things to do on Monday.
            </p>

            {findings.length === 0 ? (
              <p className="mt-6 rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-300">
                Nothing to report. Every check we ran passed.
              </p>
            ) : (
              <ul className="mt-6 divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
                {findings.map((finding) => (
                  <li key={finding.rowId} className="bg-neutral-950 p-4">
                    <Link href={`/dashboard/findings/${finding.rowId}`} className="group block">
                      <div className="flex items-baseline gap-3">
                        <SeverityBadge severity={finding.severity} />
                        <span className="font-mono text-xs text-neutral-600">{finding.ruleId}</span>
                      </div>

                      <p className="mt-2 text-neutral-200 group-hover:text-white">
                        {finding.title}
                      </p>

                      <p className="mt-1 text-xs text-neutral-600">
                        {finding.affectedUrls.length}{' '}
                        {finding.affectedUrls.length === 1 ? 'page' : 'pages'} &middot;{' '}
                        {finding.estimatedEffort} effort &middot; impact {finding.estimatedImpact}
                        /100
                        {finding.fixable && (
                          <span className="ml-2 text-emerald-600">we can write the fix</span>
                        )}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}
