import type { CompetitorChange, CompetitorWatch, Site } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { citationSentence, COINCIDENCE_NOTE } from '@/lib/citation-sentence'
import { getClient } from '@/lib/session'

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

const KIND: Record<CompetitorChange['kind'], string> = {
  title: 'Title',
  description: 'Meta description',
  h1: 'Main heading',
  new_url: 'New page',
}

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

const pathOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

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
      />

      {watch.competitors.length === 0 ? (
        <EmptyState
          figure="0"
          title="No competitors tracked yet"
          action={
            <Link href={`/visibility?siteId=${site.id}#questions`} className="btn btn-primary">
              Name your competitors
            </Link>
          }
        >
          Competitors are listed with your tracked questions, because the same list is what share of
          voice is measured against.
        </EmptyState>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="h-section mb-3">Who is being watched</h2>
            <div className="frame">
              <ul className="m-0 list-none p-0">
                {watch.competitors.map((competitor, index) => (
                  <li
                    key={competitor.domain}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                    style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
                  >
                    <span className="min-w-0 truncate">{competitor.domain}</span>
                    {/*
                      Three different answers, and none of them is a zero: not looked at yet,
                      looked and could not read, and read.
                    */}
                    <span className="text-muted text-[13px]">
                      {competitor.lastSnapshotAt === null
                        ? 'Not read yet. The first snapshot is taken on the next weekly run.'
                        : (competitor.note ??
                          `Read ${day.format(new Date(competitor.lastSnapshotAt))}, ${competitor.pagesRead} page${competitor.pagesRead === 1 ? '' : 's'}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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

            <div className="flex flex-col gap-4">
              {watch.batches.map((batch) => (
                <article key={`${batch.competitor}-${batch.detectedAt}`} className="frame">
                  <header
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
                    style={{
                      borderBottom: '1px solid var(--color-divider)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <h3 className="card-title m-0">{batch.competitor}</h3>
                    <span className="text-muted text-[13px]">
                      {batch.changes.length} change{batch.changes.length === 1 ? '' : 's'}, seen{' '}
                      {day.format(new Date(batch.detectedAt))}
                    </span>
                  </header>

                  <ul className="m-0 list-none p-0">
                    {batch.changes.map((change, index) => (
                      <li
                        key={`${change.kind}-${change.url}`}
                        className="px-4 py-3"
                        style={{
                          borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)',
                        }}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="tag tag-neutral">{KIND[change.kind]}</span>
                          <a
                            href={change.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rule-id m-0 break-all"
                          >
                            {pathOf(change.url)}
                          </a>
                        </div>
                        {change.kind !== 'new_url' && (
                          <dl className="m-0 mt-2 grid gap-1 text-sm sm:grid-cols-[3rem_1fr]">
                            <dt className="stat-label pt-0.5">Was</dt>
                            <dd className="text-muted m-0">
                              {change.before ?? <span className="text-subtle">Not present</span>}
                            </dd>
                            <dt className="stat-label pt-0.5">Now</dt>
                            <dd className="m-0">
                              {change.after ?? <span className="text-subtle">Removed</span>}
                            </dd>
                          </dl>
                        )}
                      </li>
                    ))}
                  </ul>

                  <footer className="panel-foot">
                    <div className="max-w-[80ch]">
                      <span style={{ color: 'var(--color-text)' }}>
                        {citationSentence(
                          batch.citationsBefore,
                          batch.citationsAfter,
                          watch.windowDays,
                          batch.afterComplete,
                        )}
                      </span>{' '}
                      {(batch.citationsBefore.checks > 0 || batch.citationsAfter.checks > 0) &&
                        COINCIDENCE_NOTE}
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
