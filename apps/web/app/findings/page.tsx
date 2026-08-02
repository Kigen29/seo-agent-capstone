import type { FindingListItem } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { AppNav } from '@/components/app-nav'
import { SeverityBadge } from '@/components/severity'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

const AXIS_LABEL: Record<string, string> = {
  crawl_health: 'Crawl health',
  performance: 'Performance',
  content: 'Content',
  structure: 'Structure',
  authority: 'Authority',
  local: 'Local',
  ai_visibility: 'AI visibility',
  agent_readiness: 'Agent readiness',
}

const FILTERS = ['all', 'critical', 'fixable', 'input'] as const
type Filter = (typeof FILTERS)[number]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { filter: raw } = await searchParams
  const filter: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : 'all'

  /**
   * The one place this app used to lie.
   *
   * This caught the error, called `handleApiError`, and then carried on with an empty array, so a
   * sleeping API rendered "Nothing out of true here. Run an audit and findings will land here" to
   * a user who may have had forty open findings. Every other page in the product renders the
   * waking notice; this one quietly reported a fact it had no evidence for, which is precisely
   * what the honesty principle exists to prevent.
   */
  let findings: FindingListItem[]
  try {
    findings = await api.listFindings()
  } catch (error) {
    // Returns only for the API-is-waking case; redirects or rethrows otherwise.
    handleApiError(error)
    return <ApiAsleep />
  }

  const counts = {
    all: findings.length,
    critical: findings.filter((f) => f.severity === 'critical').length,
    fixable: findings.filter((f) => f.fixable).length,
    input: findings.filter((f) => !f.fixable).length,
  }

  const shown = findings.filter((f) =>
    filter === 'critical'
      ? f.severity === 'critical'
      : filter === 'fixable'
        ? f.fixable
        : filter === 'input'
          ? !f.fixable
          : true,
  )

  const segments: { key: Filter; label: string }[] = [
    { key: 'all', label: `All ${counts.all}` },
    { key: 'critical', label: `Critical ${counts.critical}` },
    { key: 'fixable', label: `Fixable in code ${counts.fixable}` },
    { key: 'input', label: `Needs input ${counts.input}` },
  ]

  return (
    <>
      <AppNav />

      <main id="main" className="wrap">
        <PageHeader kicker="Findings" title="Everything out of true, in one list." />

        <div className="mb-4 flex gap-2">
          <span className="seg">
            {segments.map((s) => (
              <Link
                key={s.key}
                href={`/findings?filter=${s.key}`}
                className={`seg-opt${filter === s.key ? ' is-active' : ''}`}
              >
                <span>{s.label}</span>
              </Link>
            ))}
          </span>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            figure="0"
            title="Nothing out of true here"
            action={
              counts.all === 0 ? (
                <Link href="/dashboard" className="btn btn-primary">
                  Run an audit
                </Link>
              ) : (
                <Link href="/findings" className="btn btn-secondary">
                  Clear the filter
                </Link>
              )
            }
          >
            {counts.all === 0
              ? 'Run an audit and findings will land here, sorted by impact over effort.'
              : 'No findings match this filter.'}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Finding</th>
                  <th>Site</th>
                  <th>Axis</th>
                  <th>Severity</th>
                  <th>Type</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.rowId}>
                    <td>{f.title}</td>
                    <td className="text-muted">{hostOf(f.siteUrl)}</td>
                    <td>{AXIS_LABEL[f.axis] ?? f.axis}</td>
                    <td>
                      <SeverityBadge severity={f.severity} />
                    </td>
                    <td>
                      <span className={`tag ${f.fixable ? 'tag-outline' : 'tag-neutral'}`}>
                        {f.fixable ? 'Fixable in code' : 'Needs input'}
                      </span>
                    </td>
                    <td>
                      <Link href={`/dashboard/findings/${f.rowId}`}>View &rarr;</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
