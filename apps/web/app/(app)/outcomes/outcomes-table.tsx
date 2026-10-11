import type { FixOutcome } from '@seo/api-client'
import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { OutboundLink } from '@/components/ui/outbound-link'
import { formatDay, plural } from '@/lib/format'

/**
 * Every fix the agent proposed for a site, and what became of it.
 *
 * One row per fix: what it was, where it stands, and the evidence in words and figures. The ones
 * that did not work are rows like any other, which is the point of the page.
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
      'Merged. The live site is checked over the next two days, starting within the hour. A fix that is live is confirmed as soon as it is seen.',
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

function metricLine(outcome: FixOutcome): string | null {
  const before = outcome.verification?.before.metrics[0] ?? outcome.baseline?.metrics[0]
  const after = outcome.verification?.after.metrics[0]
  if (!before) return null
  const pages = (n: number) => plural(n, 'page')
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
    return `Search traffic before and after: ready around ${formatDay(ready)}, if Search Console is connected.`
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

/** What was measured: the sentence, the page counts, and the traffic either side of the fix. */
function Evidence({ outcome }: { outcome: FixOutcome }) {
  const status = STATUS[outcome.status]
  const metrics = metricLine(outcome)
  const traffic = trafficLine(outcome)
  const hasClicks = outcome.verification?.after.metrics.some(
    (metric) => metric.metric === CLICKS_METRIC,
  )
  return (
    <div className="flex max-w-[60ch] flex-col gap-2 text-[13px]">
      <div className="text-muted">
        {outcome.verification?.summary ?? status.detail}
        {outcome.verification && ` Checked ${formatDay(outcome.verification.verifiedAt)}.`}
      </div>
      {outcome.note && <div className="text-muted">{outcome.note}</div>}
      {metrics && <div className="mono tnum text-[12px]">{metrics}</div>}
      {traffic && (
        <div className="tnum">
          {traffic}
          {hasClicks && (
            <span className="text-muted block text-[12px]">
              Traffic moves for many reasons, including seasons and Google updates. This is what
              changed, not proof of why.
            </span>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer">How we check it worked</summary>
        <div className="text-muted mt-1">{outcome.falsification}</div>
      </details>
    </div>
  )
}

export function OutcomesTable({ outcomes, siteId }: { outcomes: FixOutcome[]; siteId: string }) {
  return (
    <DataTable
      label="Proposed fixes and what became of them"
      className="mt-6"
      stack
      columns={[
        { header: 'Fix' },
        { header: 'Where it stands', className: 'whitespace-nowrap' },
        { header: 'What we measured' },
        { header: 'Pull request', hideHeader: true, align: 'end', className: 'whitespace-nowrap' },
      ]}
      rows={outcomes.map((outcome) => ({
        key: outcome.rowId,
        cells: [
          <div key="fix" className="max-w-[40ch]">
            <span className="rule-id">{outcome.ruleId}</span>
            <Link href={`/findings/${outcome.rowId}?siteId=${siteId}`}>{outcome.title}</Link>
          </div>,
          <span key="status" className={STATUS[outcome.status].tag}>
            {STATUS[outcome.status].label}
          </span>,
          <Evidence key="evidence" outcome={outcome} />,
          outcome.prUrl ? (
            <OutboundLink key="pr" href={outcome.prUrl}>
              Pull request
            </OutboundLink>
          ) : null,
        ],
      }))}
    />
  )
}
