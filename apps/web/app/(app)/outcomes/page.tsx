import type { SiteOutcomes } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { OutcomesTable } from './outcomes-table'

export const dynamic = 'force-dynamic'

/**
 * Did the fixes work?
 *
 * The last step of the loop: a fix is proposed, merged, deployed, and measured against what the
 * finding claimed. This page lists every fix the agent has proposed for a site with its answer in
 * words, including the ones that did not work, which is the point: an outcome report that only
 * showed successes would be an advertisement.
 */

export const metadata = { title: 'Outcomes' }

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
        <OutcomesTable outcomes={outcomes} siteId={site.id} />
      )}
    </main>
  )
}

const percent = (rate: number | null) => (rate === null ? 'n/a' : `${Math.round(rate * 100)}%`)
