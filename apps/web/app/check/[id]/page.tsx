import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ScorecardGrid } from '@/components/scorecard'
import { EvidenceBlock } from '@/components/evidence'
import { SeverityBadge } from '@/components/severity'
import { apiUrl } from '@/lib/session'

/**
 * A check result, shareable by link.
 *
 * `noindex`, and the reason is not shyness: these are pages about somebody else's website,
 * created by whoever pasted the URL, and letting search engines index them would publish an
 * unsolicited audit of a stranger's site under our domain. The id is the authorisation, the page
 * expires after 30 days, and neither of those is worth much if Google has a copy (ADR-0025).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface CheckResult {
  id: string
  url: string
  finalUrl: string
  findings: {
    id: string
    ruleId: string
    title: string
    severity: string
    fixable: boolean
    evidence: Parameters<typeof EvidenceBlock>[0]['evidence']
    falsification: string
  }[]
  scorecard: Parameters<typeof ScorecardGrid>[0]['scorecard']
  limitations: string[]
}

export default async function CheckResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const response = await fetch(`${apiUrl()}/check/${id}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null)

  if (!response?.ok) notFound()

  const check = (await response.json()) as CheckResult
  const fixable = check.findings.filter((finding) => finding.fixable).length

  return (
    <main id="main" className="wrap" style={{ paddingBlock: 'var(--space-8)' }}>
      <p className="card-kicker">Free check</p>
      <h1 className="h-page mb-2 break-all">{check.finalUrl}</h1>
      <p className="text-muted mt-0 mb-6 max-w-[62ch] text-sm">
        {check.findings.length === 0
          ? 'Nothing failed on the checks this could run. That is a narrower statement than it looks; see what was not checked, below.'
          : `${check.findings.length} finding${check.findings.length === 1 ? '' : 's'} on this page` +
            (fixable > 0 ? `, ${fixable} of which an agent could fix with a pull request.` : '.')}
      </p>

      <ScorecardGrid scorecard={check.scorecard} />

      {check.findings.length > 0 && (
        <section style={{ marginTop: 'var(--space-8)' }}>
          <h2 className="h-section mb-3">What we found</h2>

          <div className="flex flex-col gap-4">
            {check.findings.map((finding) => (
              <article key={finding.id} className="card elev-sm gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={finding.severity as never} />
                  <span className="text-muted text-[12px]">{finding.ruleId}</span>
                  {finding.fixable && (
                    <span className="tag tag-outline">a pull request could fix this</span>
                  )}
                </div>

                <h3 className="m-0 text-sm">{finding.title}</h3>

                {/*
                  The evidence, on a free page, with no email gate. The competitor withholds this
                  and it is the half that makes a finding checkable rather than a claim.
                */}
                <EvidenceBlock evidence={finding.evidence} />

                <p className="text-muted m-0 text-[13px]">
                  <strong>How you would know this was wrong:</strong> {finding.falsification}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 'var(--space-8)' }}>
        <h2 className="h-section mb-2">What this did not check</h2>
        <ul className="text-muted m-0 grid gap-2 pl-5 text-sm">
          {check.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/login" className="btn btn-primary">
          Audit the whole site
        </Link>
        <Link href="/check" className="btn btn-ghost">
          Check another page
        </Link>
      </div>

      <p className="text-muted mt-6 mb-0 text-[13px]">
        This link works for 30 days and is not indexed by search engines.
      </p>
    </main>
  )
}
