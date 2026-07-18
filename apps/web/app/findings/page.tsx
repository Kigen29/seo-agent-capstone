import type { FindingListItem } from '@seo/api-client'
import Link from 'next/link'
import { AppNav } from '@/components/app-nav'
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

const SEV_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/** Severity tints, following the design: accent for critical/high, neutral for the rest. */
const SEV_STYLE: Record<string, { background: string; color: string }> = {
  critical: { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)' },
  high: { background: 'var(--color-accent-100)', color: 'var(--color-accent-700)' },
  medium: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-800)' },
  low: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-700)' },
  info: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-600)' },
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

  let findings: FindingListItem[] = []
  try {
    findings = await api.listFindings()
  } catch (error) {
    // Returns for the API-is-waking case; rethrows (or redirects) otherwise.
    handleApiError(error)
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
      <AppNav active="findings" />

      <div className="wrap">
        <div className="card-kicker">Findings</div>
        <h1 style={{ fontWeight: 400, marginBottom: 'var(--space-4)' }}>
          Everything out of true, in one list.
        </h1>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
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
          <div
            className="card elev-sm"
            style={{
              padding: 'var(--space-8)',
              textAlign: 'center',
              maxWidth: '520px',
              margin: 'var(--space-8) auto 0',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '40px',
                color: 'var(--color-accent-700)',
                marginBottom: 'var(--space-3)',
              }}
            >
              0
            </div>
            <h4 style={{ marginBottom: 'var(--space-2)' }}>Nothing out of true here</h4>
            <p style={{ fontSize: '14px', opacity: 0.8, margin: 0 }}>
              {counts.all === 0
                ? 'Run an audit and findings will land here, sorted by impact over effort.'
                : 'No findings match this filter.'}
            </p>
          </div>
        ) : (
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
              {shown.map((f) => {
                const sev = SEV_STYLE[f.severity] ?? SEV_STYLE.medium
                return (
                  <tr key={f.rowId}>
                    <td>{f.title}</td>
                    <td style={{ opacity: 0.7 }}>{hostOf(f.siteUrl)}</td>
                    <td>{AXIS_LABEL[f.axis] ?? f.axis}</td>
                    <td>
                      <span className="tag" style={sev}>
                        {SEV_LABEL[f.severity] ?? f.severity}
                      </span>
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
