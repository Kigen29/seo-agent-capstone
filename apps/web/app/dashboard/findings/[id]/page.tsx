import type { Evidence } from '@seo/core'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { SeverityBadge } from '@/components/severity'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { openFixPr } from './actions'

export const dynamic = 'force-dynamic'

const EFFORT_LABEL: Record<string, string> = {
  trivial: 'Trivial',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

/** The banner shown after an Open-a-pull-request click, keyed on the ?fix= status. */
const FIX_MESSAGE: Record<string, { tone: string; text: string }> = {
  queued: {
    tone: 'note note-ok',
    text: 'The agent is opening a pull request that fixes this. It will appear here as an open PR shortly.',
  },
  failed: {
    tone: 'note note-error',
    text: 'Could not open a pull request. Connect a repository to this site, or check that no PR is already open, then try again.',
  },
}

export default async function FindingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fix?: string }>
}) {
  const { id } = await params
  const { fix } = await searchParams
  const api = await getClient()
  if (!api) return null

  let finding
  let connections
  try {
    ;[finding, connections] = await Promise.all([api.getFinding(id), api.getConnections()])
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const fixMessage = fix ? FIX_MESSAGE[fix] : undefined

  return (
    <main className="wrap-narrow">
      <Link href={`/dashboard/audits/${finding.auditId}`} style={{ fontSize: 13 }}>
        &larr; Back to the audit
      </Link>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          margin: 'var(--space-4) 0 var(--space-3)',
        }}
      >
        <SeverityBadge severity={finding.severity} />
        <span className="tag tag-neutral">{finding.ruleId}</span>
        {finding.fixable && <span className="tag tag-outline">Fixable in code</span>}
      </div>

      <h1 style={{ fontWeight: 400, marginBottom: 'var(--space-4)' }}>{finding.title}</h1>

      {/* The action that closes the loop: turn this finding into a pull request. */}
      {finding.status === 'pr_open' && finding.prUrl ? (
        <a
          href={finding.prUrl}
          target="_blank"
          rel="noreferrer"
          className="note note-ok"
          style={{ display: 'block', marginBottom: 'var(--space-6)' }}
        >
          A pull request that fixes this is open. Review and merge it &rarr;
        </a>
      ) : finding.status === 'merged' ? (
        <p className="note note-ok" style={{ marginBottom: 'var(--space-6)' }}>
          The fix has been merged. It verifies once the change is deployed and re-crawled.
        </p>
      ) : finding.status === 'verified' ? (
        <p className="note note-ok" style={{ marginBottom: 'var(--space-6)' }}>
          Verified fixed.
        </p>
      ) : (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          {fixMessage && (
            <p role="status" className={fixMessage.tone} style={{ marginBottom: 'var(--space-3)' }}>
              {fixMessage.text}
            </p>
          )}
          {finding.fixable &&
            (connections.github.connected ? (
              <form action={openFixPr}>
                <input type="hidden" name="findingId" value={finding.rowId} />
                <button type="submit" className="btn btn-primary">
                  Open a pull request
                </button>
              </form>
            ) : (
              <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>
                Connect a repository to this site to open a fix pull request.
              </p>
            ))}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Stat
          label="Effort"
          value={EFFORT_LABEL[finding.estimatedEffort] ?? finding.estimatedEffort}
        />
        <Stat label="Impact" value={`${finding.estimatedImpact}/100`} />
        <Stat label="Confidence" value={`${Math.round(finding.confidence * 100)}%`} />
        <Stat label="Fixable" value={finding.fixable ? 'We can write it' : 'Needs a human'} />
      </div>

      {/*
        The falsification condition, first and largest, because it is the thing that separates
        this from every other SEO tool's list of opinions. If we cannot say what would prove us
        wrong, we do not have a finding, we have a vibe. It is required by the type, by the Zod
        schema, and by a NOT NULL column, so it cannot be missing here.
      */}
      <section
        className="card elev-sm"
        style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)' }}
      >
        <div className="card-kicker">How you would know we were wrong</div>
        <p style={{ margin: 'var(--space-2) 0 0', lineHeight: 1.7 }}>{finding.falsification}</p>
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 12, opacity: 0.55 }}>
          Every finding carries one. Advice that cannot be proven wrong is not advice, and we refuse
          to ship it.
        </p>
      </section>

      <section style={{ marginBottom: 'var(--space-6)' }}>
        <h5 style={{ marginBottom: 'var(--space-2)' }}>What we actually observed</h5>
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 14, opacity: 0.7 }}>
          Not an opinion, and not a guess from a language model. A parser saw this.
        </p>

        <EvidenceBlock evidence={finding.evidence} />
      </section>

      <section>
        <h5 style={{ marginBottom: 'var(--space-3)' }}>
          Affected pages ({finding.affectedUrls.length})
        </h5>

        <div className="card elev-sm" style={{ gap: 0, padding: 0 }}>
          {finding.affectedUrls.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: 'var(--space-3)',
                fontSize: 13,
                wordBreak: 'break-all',
                borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
              }}
            >
              {url}
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ gap: 'var(--space-1)', padding: 'var(--space-3)' }}>
      <div className="card-kicker">{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
    </div>
  )
}

/**
 * Evidence is a discriminated union, and each kind has something different worth showing.
 * Rendering a JSON blob would be technically complete and useless: the point is that a human
 * can look at this and check it themselves.
 */
function EvidenceBlock({ evidence }: { evidence: Evidence }) {
  const pre = (text: string) => <pre className="mono">{text}</pre>
  const caption = (text: string) => (
    <p
      style={{ margin: 'var(--space-2) 0 0', fontSize: 12, opacity: 0.55, wordBreak: 'break-all' }}
    >
      {text}
    </p>
  )

  switch (evidence.kind) {
    case 'http':
      return pre(
        [
          `${evidence.url}`,
          `status: ${evidence.status}`,
          evidence.redirectChain.length > 0
            ? `redirects: ${evidence.redirectChain.join(' -> ')}`
            : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      )

    case 'markup':
      return (
        <>
          {/* An empty snippet means the element was absent, which is usually the finding. */}
          {pre(evidence.snippet === '' ? '(the element was not there)' : evidence.snippet)}
          {caption(`${evidence.url} @ ${evidence.locator}`)}
        </>
      )

    case 'metric':
      return (
        <>
          {pre(`${evidence.metric}: ${evidence.value}${evidence.unit}`)}
          {/*
            Core Web Vitals mean nothing without their percentile: they are defined at the
            75th of real Chrome users over 28 days. Printing a bare number invites a lab
            measurement to be read as a field one, which is the single most common way an
            SEO report misleads. If we know the percentile, we say it.
          */}
          {evidence.percentile !== undefined &&
            caption(`at the ${evidence.percentile}th percentile of real users`)}
        </>
      )

    case 'file':
      return (
        <>
          {pre(evidence.excerpt)}
          {caption(`${evidence.path}${evidence.line !== undefined ? `:${evidence.line}` : ''}`)}
        </>
      )

    case 'graph':
      return (
        <>
          {pre(
            [
              `inbound internal links: ${evidence.inboundInternalLinks}`,
              `click depth from the homepage: ${evidence.clickDepth ?? 'unreachable by crawling'}`,
            ].join('\n'),
          )}
          {caption(evidence.url)}
        </>
      )

    case 'search':
      return (
        <>
          {pre(
            [
              evidence.query ? `query: "${evidence.query}"` : undefined,
              `average position: ${evidence.position.toFixed(1)}`,
              `impressions: ${evidence.impressions.toLocaleString()}`,
              `clicks: ${evidence.clicks.toLocaleString()}`,
              `click-through rate: ${(evidence.ctr * 100).toFixed(1)}%`,
            ]
              .filter(Boolean)
              .join('\n'),
          )}
          {caption(
            `Real Search Console data over ${evidence.startDate} to ${evidence.endDate}. Position is the average rank across those impressions; Search Console lags two to three days.`,
          )}
        </>
      )
  }
}
