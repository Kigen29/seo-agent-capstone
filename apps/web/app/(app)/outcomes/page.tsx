import type { FixOutcome, SiteOutcomes } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Did the fixes work?
 *
 * The last step of the loop: a fix is proposed, merged, deployed, and measured against what the
 * finding claimed. This page lists every fix the agent has proposed for a site with its answer in
 * words, including the ones that did not work, which is the point: an outcome report that only
 * showed successes would be an advertisement.
 */

const STATUS: Record<FixOutcome['status'], { label: string; tag: string; detail: string }> = {
  pr_open: {
    label: 'Waiting for your review',
    tag: 'tag tag-accent',
    detail: 'The pull request is open. Merge it and the agent checks the result once it is live.',
  },
  merged: {
    label: 'Merged, checking',
    tag: 'tag tag-outline',
    detail:
      'Merged. The agent re-audits once the change is deployed and records whether it worked.',
  },
  verified: {
    label: 'Worked',
    tag: 'tag tag-success',
    detail: 'Checked after deployment: the problem is gone.',
  },
  rejected: {
    label: 'Did not work',
    tag: 'tag tag-critical',
    detail: 'Checked after deployment: the problem is still there.',
  },
}

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

function metricLine(outcome: FixOutcome): string | null {
  const before = outcome.verification?.before.metrics[0] ?? outcome.baseline?.metrics[0]
  const after = outcome.verification?.after.metrics[0]
  if (!before) return null
  const pages = (n: number) => `${n} page${n === 1 ? '' : 's'}`
  if (!after) return `Before: ${pages(before.value)} failing ${outcome.ruleId}.`
  return `Before: ${pages(before.value)} failing. After: ${pages(after.value)} failing.`
}

/**
 * The same names and timing the worker's traffic sweep uses (packages/audit/src/traffic-outcome.ts),
 * restated because the web app may not import a package that reaches the database (ADR-0009).
 */
const CLICKS_METRIC = 'Search clicks, 28 days'
const IMPRESSIONS_METRIC = 'Search impressions, 28 days'
const TRAFFIC_READY_DAYS = 28 + 3

function trafficLine(outcome: FixOutcome): string | null {
  const verification = outcome.verification
  if (!verification) return null
  const value = (metrics: { metric: string; value: number }[], name: string) =>
    metrics.find((metric) => metric.metric === name)?.value
  const clicksAfter = value(verification.after.metrics, CLICKS_METRIC)
  if (clicksAfter === undefined) {
    const ready = new Date(
      new Date(verification.verifiedAt).getTime() + TRAFFIC_READY_DAYS * 86_400_000,
    )
    return `Search traffic before and after: ready around ${day.format(ready)}, if Search Console is connected.`
  }
  const clicksBefore = value(verification.before.metrics, CLICKS_METRIC) ?? 0
  const impressionsBefore = value(verification.before.metrics, IMPRESSIONS_METRIC) ?? 0
  const impressionsAfter = value(verification.after.metrics, IMPRESSIONS_METRIC) ?? 0
  const n = (count: number) => count.toLocaleString('en-US')
  return (
    `Search traffic to these pages, 28 days before and after: ${n(clicksBefore)} to ${n(clicksAfter)} ` +
    `clicks, ${n(impressionsBefore)} to ${n(impressionsAfter)} impressions.`
  )
}

export default async function OutcomesPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null
  const { siteId } = await searchParams

  let site
  let result: SiteOutcomes | undefined
  try {
    const sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site) result = await api.getOutcomes(site.id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (!site || !result) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="Outcomes" title="Did the fixes work?" />
        <EmptyState figure="0" title="No site yet">
          Add a site and run an audit first. Fixes and their outcomes appear here.
        </EmptyState>
      </main>
    )
  }

  const { counts, outcomes, rates } = result
  const decided = counts.verified + counts.rejected

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Outcomes"
        title="Did the fixes work?"
        description="Every fix the agent has proposed for this site, checked after it went live against the condition stated before it was written. Fixes that did not work stay on this list."
      />

      <StatRow>
        <Stat label="Waiting for review" value={String(counts.pr_open)} />
        <Stat
          label="Merged, checking"
          value={String(counts.merged)}
          tone={counts.merged > 0 ? 'accent' : undefined}
        />
        <Stat label="Worked" value={String(counts.verified)} />
        <Stat label="Did not work" value={String(counts.rejected)} />
      </StatRow>
      {decided > 0 && (
        <p className="text-muted mt-2 mb-0 text-[13px]">
          {counts.verified} of {decided} checked fix{decided === 1 ? '' : 'es'} worked.
        </p>
      )}
      {rates.merged + rates.closedUnmerged > 0 && (
        <p className="text-muted mt-1 mb-0 text-[13px]" data-testid="pr-rates">
          {rates.merged} of {rates.merged + rates.closedUnmerged} decided pull request
          {rates.merged + rates.closedUnmerged === 1 ? ' was' : 's were'} merged (
          {percent(rates.mergeRate)}).
          {rates.merged > 0 &&
            ` ${rates.reverted} ${rates.reverted === 1 ? 'was' : 'were'} later reverted (${percent(rates.revertRate)}).`}
        </p>
      )}

      {outcomes.length === 0 ? (
        <div className="mt-6">
          <EmptyState figure="0" title="No fixes proposed yet">
            Open a fixable finding and choose Fix with a pull request. Its outcome is tracked here
            from the moment the pull request opens. <Link href="/findings">See findings</Link>
          </EmptyState>
        </div>
      ) : (
        <ul className="m-0 mt-6 flex list-none flex-col gap-3 p-0">
          {outcomes.map((outcome) => {
            const status = STATUS[outcome.status]
            const line = metricLine(outcome)
            return (
              <li
                key={outcome.rowId}
                className="card"
                style={{ padding: 'var(--space-5)', gap: 'var(--space-3)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={status.tag}>{status.label}</span>
                  <span className="tag tag-neutral" style={{ fontFamily: 'var(--font-mono)' }}>
                    {outcome.ruleId}
                  </span>
                </div>
                <Link href={`/findings/${outcome.rowId}`} className="card-title">
                  {outcome.title}
                </Link>
                <p className="text-muted m-0 text-[13px]">
                  {outcome.verification?.summary ?? status.detail}
                  {outcome.verification &&
                    ` Checked ${day.format(new Date(outcome.verification.verifiedAt))}.`}
                </p>
                {outcome.note && <p className="text-muted m-0 text-[13px]">{outcome.note}</p>}
                {line && (
                  <div
                    className="mono tnum"
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}
                  >
                    {line}
                  </div>
                )}
                {trafficLine(outcome) && (
                  <p className="tnum m-0 text-sm">
                    {trafficLine(outcome)}
                    {outcome.verification?.after.metrics.some(
                      (metric) => metric.metric === CLICKS_METRIC,
                    ) && (
                      <span className="text-muted block text-[12px]">
                        Traffic moves for many reasons, including seasons and Google updates. This
                        is what changed, not proof of why.
                      </span>
                    )}
                  </p>
                )}
                <div className="card-foot">
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer">How we check it worked</summary>
                    <div className="mt-2 max-w-[68ch]">{outcome.falsification}</div>
                  </details>
                  {outcome.prUrl && (
                    <a href={outcome.prUrl} target="_blank" rel="noreferrer" className="shrink-0">
                      View the pull request &rarr;
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

const percent = (rate: number | null) => (rate === null ? 'n/a' : `${Math.round(rate * 100)}%`)
