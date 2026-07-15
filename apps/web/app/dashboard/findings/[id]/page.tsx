import type { Evidence } from '@seo/core'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { SeverityBadge } from '@/components/severity'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

const EFFORT_LABEL: Record<string, string> = {
  trivial: 'Trivial',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const api = await getClient()
  if (!api) return null

  let finding
  try {
    finding = await api.getFinding(id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  return (
    <main className="mt-10">
      <Link
        href={`/dashboard/audits/${finding.auditId}`}
        className="text-sm text-neutral-600 hover:text-neutral-400"
      >
        &larr; Back to the audit
      </Link>

      <div className="mt-6 flex items-baseline gap-3">
        <SeverityBadge severity={finding.severity} />
        <span className="font-mono text-xs text-neutral-600">{finding.ruleId}</span>
      </div>

      <h1 className="mt-3 text-2xl leading-snug font-semibold text-neutral-50">{finding.title}</h1>

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
        <Stat
          label="Effort"
          value={EFFORT_LABEL[finding.estimatedEffort] ?? finding.estimatedEffort}
        />
        <Stat label="Impact" value={`${finding.estimatedImpact}/100`} />
        <Stat label="Confidence" value={`${Math.round(finding.confidence * 100)}%`} />
        <Stat label="Fixable" value={finding.fixable ? 'We can write it' : 'Needs a human'} />
      </dl>

      {/*
        The falsification condition, first and largest, because it is the thing that separates
        this from every other SEO tool's list of opinions. If we cannot say what would prove us
        wrong, we do not have a finding, we have a vibe. It is required by the type, by the Zod
        schema, and by a NOT NULL column, so it cannot be missing here.
      */}
      <section className="mt-10 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-5">
        <h2 className="text-xs font-medium tracking-widest text-emerald-500 uppercase">
          How you would know we were wrong
        </h2>
        <p className="mt-3 leading-relaxed text-emerald-100/90">{finding.falsification}</p>
        <p className="mt-3 text-xs leading-relaxed text-emerald-200/40">
          Every finding carries one. Advice that cannot be proven wrong is not advice, and we refuse
          to ship it.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
          What we actually observed
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          Not an opinion, and not a guess from a language model. A parser saw this.
        </p>

        <EvidenceBlock evidence={finding.evidence} />
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
          Affected pages ({finding.affectedUrls.length})
        </h2>

        <ul className="mt-4 divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
          {finding.affectedUrls.map((url) => (
            <li key={url} className="bg-neutral-950 p-3">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm break-all text-neutral-400 hover:text-neutral-200"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-950 p-4">
      <dt className="text-xs tracking-wide text-neutral-600 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-200">{value}</dd>
    </div>
  )
}

/**
 * Evidence is a discriminated union, and each kind has something different worth showing.
 * Rendering a JSON blob would be technically complete and useless: the point is that a human
 * can look at this and check it themselves.
 */
function EvidenceBlock({ evidence }: { evidence: Evidence }) {
  const pre = (text: string) => (
    <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 font-mono text-xs leading-relaxed text-neutral-300">
      {text}
    </pre>
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
          <p className="mt-2 font-mono text-xs break-all text-neutral-600">
            {evidence.url} @ {evidence.locator}
          </p>
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
          {evidence.percentile !== undefined && (
            <p className="mt-2 text-xs text-neutral-600">
              at the {evidence.percentile}th percentile of real users
            </p>
          )}
        </>
      )

    case 'file':
      return (
        <>
          {pre(evidence.excerpt)}
          <p className="mt-2 font-mono text-xs text-neutral-600">
            {evidence.path}
            {evidence.line !== undefined ? `:${evidence.line}` : ''}
          </p>
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
          <p className="mt-2 font-mono text-xs break-all text-neutral-600">{evidence.url}</p>
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
          <p className="mt-2 text-xs text-neutral-600">
            Real Search Console data over {evidence.startDate} to {evidence.endDate}. Position is
            the average rank across those impressions; Search Console lags two to three days.
          </p>
        </>
      )
  }
}
