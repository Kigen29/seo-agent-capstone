import type { CompetitorWatch, Site } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { AddCompetitor } from './add-competitor'
import { ChangesTable, WatchedTable } from './watch-tables'

export const dynamic = 'force-dynamic'

/**
 * Competitor watch: what the competitors you track changed, and what happened next (ADR-0034).
 *
 * The page is two facts set side by side and a refusal to join them. A change to a competitor's
 * page is a fact; their AI citations in the week before and the week after are facts; that the
 * first produced the second is not something either can show. So every comparison is two counts
 * with their samples, followed by the same sentence saying what it is not.
 *
 * It is also strictly a reader. Snapshots are taken by the weekly sweep on the worker, and there
 * is no button here to take one now, because a button that makes our servers fetch somebody
 * else's site on demand is a different product from one that looks once a week.
 */

export const metadata = { title: 'Competitors' }

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId } = await searchParams

  let sites: Site[]
  let site: Site | undefined
  let watch: CompetitorWatch | undefined
  try {
    sites = await api.listSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site) watch = await api.getCompetitorWatch(site.id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (!site || !watch) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="Research" title="Competitor watch" />
        <EmptyState
          figure="0"
          title="No sites yet"
          action={
            <Link href="/dashboard" className="btn btn-primary">
              Add a site
            </Link>
          }
        >
          Add a site and name the competitors to compare it with, and the weekly watch starts.
        </EmptyState>
      </main>
    )
  }

  const read = watch.competitors.filter((competitor) => competitor.lastSnapshotAt !== null)

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Research"
        title="What did your competitors change?"
        description={`Once every ${watch.intervalDays} days we read a few public pages on each competitor you track and record what is different: titles, meta descriptions, main headings and pages new to their sitemap. Beside each change are their AI citations before and after it.`}
        actions={
          <AddCompetitor
            siteId={site.id}
            tracked={watch.competitors.map((competitor) => competitor.domain)}
          />
        }
      />

      {watch.competitors.length === 0 ? (
        <EmptyState
          figure="0"
          title="No competitors tracked yet"
          action={
            <Link href={`/site?siteId=${site.id}`} className="btn btn-primary">
              Choose your competitors
            </Link>
          }
        >
          We can suggest competitors from what you offer and where, or you can add the ones you
          know. The weekly watch starts once there is at least one.
        </EmptyState>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="h-section mb-3">Who is being watched</h2>
            <WatchedTable competitors={watch.competitors} />
          </section>

          <section>
            <h2 className="h-section mb-1">What changed</h2>
            <p className="text-muted mt-0 mb-3 max-w-[68ch] text-sm">
              Newest first. A change is something that differs between two weekly readings, so it
              was made at some point in the week before the date shown.
            </p>

            {watch.batches.length === 0 &&
              (read.length === 0 ? (
                <Note tone="info">
                  Nothing has been read yet. The watch runs weekly on the worker, so the first
                  readings arrive within a few days and the first comparison a week after that.
                </Note>
              ) : (
                <Note tone="info">
                  No changes recorded. Either nothing differed between the last two readings, or
                  there has only been one reading so far and there is nothing to compare it with.
                </Note>
              ))}

            <ChangesTable batches={watch.batches} windowDays={watch.windowDays} />
          </section>
        </>
      )}
    </main>
  )
}
