import { redirect } from 'next/navigation'
import type { FixAttempt } from '@seo/api-client'
import { ApiAsleep } from '@/components/api-asleep'
import Link from 'next/link'
import { EvidenceBlock } from '@/components/evidence'
import { SeverityBadge } from '@/components/severity'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Note } from '@/components/ui/note'
import { OutcomeNote, outcomeFor, type Outcome } from '@/components/ui/outcome-note'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { manualReasonFor } from '@/lib/manual-reason'
import { AffectedPages, FixAttempts } from './finding-tables'
import { FixButton } from './fix-button'
import { FixProgress } from './fix-progress'

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

/**
 * The banner shown after an Open-a-pull-request click, keyed on the ?fix= status.
 *
 * Only the failure case is a banner. `failed` means the API refused the request outright, so
 * there is no job to watch and the message is the whole story. A queued fix is handled by
 * `FixProgress` instead, which watches the job rather than asserting once that it is on its way.
 */
const FIX: Record<string, Outcome> = {
  failed: {
    tone: 'warn',
    title: 'The pull request was not started',
    detail:
      'Check that a repository is connected to this site and that a pull request for this finding is not already open, then try again.',
  },
}

export const metadata = { title: 'Finding' }

export default async function FindingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fix?: string; siteId?: string }>
}) {
  const { id } = await params
  const { fix, siteId } = await searchParams
  const api = await getClient()
  if (!api) return null

  let finding
  let connections
  let attempts: FixAttempt[] = []
  let historyUnavailable = false
  try {
    ;[finding, connections, attempts] = await Promise.all([
      api.getFinding(id),
      api.getConnections(),
      // History is secondary: if it cannot load, the finding still renders without it.
      api.getFixAttempts(id).catch(() => {
        historyUnavailable = true
        return []
      }),
    ])
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (siteId !== finding.siteId)
    redirect(
      `/findings/${id}?siteId=${finding.siteId}${fix ? `&fix=${encodeURIComponent(fix)}` : ''}`,
    )

  return (
    <main id="main" className="wrap-narrow">
      {historyUnavailable && (
        <Note tone="warn">Fix history could not be loaded. Refresh to try again.</Note>
      )}
      <Breadcrumbs
        trail={[
          { label: 'Findings', href: `/findings?siteId=${finding.siteId}` },
          { label: 'Audit', href: `/audits/${finding.auditId}?siteId=${finding.siteId}` },
          { label: finding.ruleId },
        ]}
      />

      <div className="mt-4 mb-3 flex flex-wrap gap-2">
        <SeverityBadge severity={finding.severity} />
        <span className="tag tag-neutral">{finding.ruleId}</span>
        {finding.fixable ? (
          <span className="tag tag-success">Agent can fix</span>
        ) : (
          <span className="tag tag-neutral">{manualReasonFor(finding).label}</span>
        )}
      </div>

      <h1 className="mb-2">{finding.title}</h1>
      <p className="text-muted mt-0 mb-4 text-[13px]">
        First seen {firstSeen.format(new Date(finding.firstSeenAt))}
      </p>

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
      ) : finding.earlier?.work === 'in_progress' ? (
        /*
          The same issue, raised again by a newer audit while a fix from an earlier one is still
          in flight. Offering the button here would open a second pull request for it.
        */
        <Note tone="ok" className="mb-6">
          A fix for this is already in progress from an earlier audit.{' '}
          {finding.earlier.prUrl && (
            <>
              <a href={finding.earlier.prUrl} target="_blank" rel="noreferrer">
                Open the pull request
              </a>
              {' or '}
            </>
          )}
          <Link href={`/findings/${finding.earlier.rowId}?siteId=${finding.siteId}`}>
            see its progress
          </Link>
          .
        </Note>
      ) : (
        <div className="mb-6">
          {finding.earlier && (
            <Note tone={finding.earlier.work === 'regressed' ? 'warn' : 'info'} className="mb-3">
              {finding.earlier.work === 'regressed'
                ? 'This was fixed and verified before, and it is back. '
                : 'An earlier fix for this was merged and did not work. '}
              <Link href={`/findings/${finding.earlier.rowId}?siteId=${finding.siteId}`}>
                See what was tried
              </Link>
              .
            </Note>
          )}
          {/*
            A queued fix is watched, not announced.

            The old version said "it will appear here as an open PR shortly" and then never
            changed, because nothing on this page re-rendered until the user reloaded. The work
            runs on a worker that has to be started, so the honest thing is to poll and say what
            is true at each moment. `fixError` being set means the attempt already failed, and the
            note below is the better answer, so there is nothing left to wait for.
          */}
          {fix === 'queued' && !finding.fixError ? (
            <FixProgress findingId={finding.rowId} />
          ) : (
            <OutcomeNote outcome={outcomeFor(FIX, fix)} className="mb-3" />
          )}
          {/*
            The last attempt's failure, said out loud.

            Without this the user clicked the button, read "the agent is opening a pull request",
            and then watched nothing happen: the worker's error went to a job log they cannot see,
            and the finding sat here looking untouched. The button is still offered, because
            trying again is reasonable and some of these failures are transient.
          */}
          {finding.fixError && (
            <OutcomeNote
              className="mb-3"
              outcome={{
                tone: 'error',
                title: 'The last fix attempt did not finish',
                detail: finding.fixError,
              }}
            />
          )}
          {finding.fixable ? (
            connections.github.connected ? (
              <FixButton findingId={finding.rowId} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/dashboard?siteId=${finding.siteId}`}
                  className="btn btn-primary btn-sm"
                >
                  Connect a repository
                </Link>
                <span className="text-muted text-[13px]">
                  Connect the code to check whether this repository supports an automatic fix.
                </span>
              </div>
            )
          ) : (
            /*
              Say why there is no button, rather than leaving a blank space that reads as a
              missing feature. Some findings are advice; the falsification condition below says
              what to do about this one.
            */
            <p className="text-muted m-0 max-w-[68ch] text-[13px]">
              <strong>{manualReasonFor(finding).label}.</strong> {manualReasonFor(finding).why}
            </p>
          )}
        </div>
      )}

      {attempts.length > 0 && <FixAttempts attempts={attempts} />}

      <StatRow>
        <Stat
          label="Effort"
          value={EFFORT_LABEL[finding.estimatedEffort] ?? finding.estimatedEffort}
        />
        <Stat label="Impact" value={`${finding.estimatedImpact}/100`} />
        <Stat label="Confidence" value={`${Math.round(finding.confidence * 100)}%`} />
        <Stat
          label="Who fixes it"
          value={finding.fixable ? 'The agent, in a pull request' : manualReasonFor(finding).label}
        />
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
        <h2 className="h-section" style={{ marginBottom: 'var(--space-2)' }}>
          What we actually observed
        </h2>
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 14, opacity: 0.7 }}>
          Not an opinion, and not a guess from a language model. A parser saw this.
        </p>

        <EvidenceBlock evidence={finding.evidence} />
      </section>

      <AffectedPages urls={finding.affectedUrls} />
    </main>
  )
}

const firstSeen = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
