import { ApiAsleep } from '@/components/api-asleep'
import { EvidenceBlock } from '@/components/evidence'
import { SeverityBadge } from '@/components/severity'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Note, type NoteTone } from '@/components/ui/note'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { FixButton } from './fix-button'

export const dynamic = 'force-dynamic'

/**
 * No `loading.tsx` here, on purpose. A Suspense boundary makes Next stream a 200 before
 * `notFound()` can set a 404, and this route 404s for another tenant's finding by design
 * (ADR-0009). See the same note on the audit route for the full reasoning.
 */

const EFFORT_LABEL: Record<string, string> = {
  trivial: 'Trivial',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

/** The banner shown after an Open-a-pull-request click, keyed on the ?fix= status. */
const FIX_MESSAGE: Record<string, { tone: NoteTone; text: string }> = {
  queued: {
    tone: 'ok',
    text: 'The agent is opening a pull request that fixes this. It will appear here as an open PR shortly.',
  },
  failed: {
    tone: 'error',
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
    <main id="main" className="wrap-narrow">
      <Breadcrumbs
        trail={[
          { label: 'Findings', href: '/findings' },
          { label: 'Audit', href: `/audits/${finding.auditId}` },
          { label: finding.ruleId },
        ]}
      />

      <div className="mt-4 mb-3 flex flex-wrap gap-2">
        <SeverityBadge severity={finding.severity} />
        <span className="tag tag-neutral">{finding.ruleId}</span>
        {finding.fixable && <span className="tag tag-outline">Fixable in code</span>}
      </div>

      <h1 className="mb-4">{finding.title}</h1>

      {/* The action that closes the loop: turn this finding into a pull request. */}
      {finding.status === 'pr_open' && finding.prUrl ? (
        <a
          href={finding.prUrl}
          target="_blank"
          rel="noreferrer"
          className="note note-ok mb-6 block"
        >
          A pull request that fixes this is open. Review and merge it &rarr;
        </a>
      ) : finding.status === 'merged' ? (
        <Note tone="ok" className="mb-6">
          The fix has been merged. It verifies once the change is deployed and re-crawled.
        </Note>
      ) : finding.status === 'verified' ? (
        <Note tone="ok" className="mb-6">
          &#10003; Verified fixed. A re-audit no longer finds this.
        </Note>
      ) : finding.status === 'rejected' ? (
        <Note tone="error" className="mb-6">
          The fix was merged, but a re-audit still finds this. It did not work; the finding stands.
        </Note>
      ) : (
        <div className="mb-6">
          {fixMessage && (
            <Note tone={fixMessage.tone} className="mb-3">
              {fixMessage.text}
            </Note>
          )}
          {/*
            The last attempt's failure, said out loud.

            Without this the user clicked the button, read "the agent is opening a pull request",
            and then watched nothing happen: the worker's error went to a job log they cannot see,
            and the finding sat here looking untouched. The button is still offered, because
            trying again is reasonable and some of these failures are transient.
          */}
          {finding.fixError && (
            <Note tone="error" className="mb-3">
              The last attempt to fix this did not produce a pull request. {finding.fixError}
            </Note>
          )}
          {finding.fixable ? (
            connections.github.connected ? (
              <FixButton findingId={finding.rowId} />
            ) : (
              <p className="text-muted m-0 text-[13px]">
                Connect a repository to this site to open a fix pull request.
              </p>
            )
          ) : (
            /*
              Say why there is no button, rather than leaving a blank space that reads as a
              missing feature. Some findings are advice; the falsification condition below says
              what to do about this one.
            */
            <p className="text-muted m-0 text-[13px]">
              This one needs a human: it cannot be fixed safely by editing a file in the repository.
              See what would prove it wrong, below.
            </p>
          )}
        </div>
      )}

      <StatRow>
        <Stat
          label="Effort"
          value={EFFORT_LABEL[finding.estimatedEffort] ?? finding.estimatedEffort}
        />
        <Stat label="Impact" value={`${finding.estimatedImpact}/100`} />
        <Stat label="Confidence" value={`${Math.round(finding.confidence * 100)}%`} />
        <Stat label="Fixable" value={finding.fixable ? 'We can write it' : 'Needs a human'} />
      </StatRow>

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
