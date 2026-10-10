import type { FindingPage } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { BulkFix, BulkFixOutcome } from './bulk-fix'
import { FilterBar } from './filter-bar'
import { FindingCards, FindingsTable, SORTS } from './findings-list'

export const dynamic = 'force-dynamic'

/** What the last bulk request did. Shown once, not carried onto sort and paging links. */
const OUTCOME_KEYS = new Set(['bulk', 'queued', 'skipped', 'remaining', 'why'])

export const metadata = { title: 'Findings' }

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const api = await getClient()
  if (!api) return null

  const params = await searchParams
  const sort = SORTS.some((s) => s.key === params.sort) ? (params.sort as string) : 'priority'
  const page = Number(params.page) > 0 ? Number(params.page) : 1

  /**
   * One page, filtered and sorted by the server.
   *
   * This used to call `listFindings()` with no arguments, receive every finding the tenant had,
   * and filter it in the browser. Every one of these parameters is now applied in SQL against an
   * indexed priority score, so a filter click costs one page rather than the whole backlog.
   */
  let result: FindingPage
  let sites: { id: string; url: string }[]
  try {
    ;[result, sites] = await Promise.all([
      api.listFindings({
        ...(params.siteId ? { siteId: params.siteId } : {}),
        ...(params.axis ? { axis: params.axis as never } : {}),
        ...(params.severity ? { severity: params.severity as never } : {}),
        ...(params.status ? { status: params.status as never } : {}),
        ...(params.fixable ? { fixable: params.fixable === 'true' } : {}),
        ...(params.q ? { q: params.q } : {}),
        sort: sort as never,
        page,
      }),
      api.listSites(),
    ])
  } catch (error) {
    // Returns only for the API-is-waking case; redirects or rethrows otherwise. Rendering an
    // empty table here would tell the user they have no findings when the API is merely asleep.
    handleApiError(error)
    return <ApiAsleep />
  }

  // How many of this site's open findings the agent can take, for the one-click action. Asked
  // separately because the page above may be filtered to something else. One row, for the count.
  const fixableOpen = params.siteId
    ? await api
        .listFindings({ siteId: params.siteId, fixable: true, status: 'open', pageSize: 1 })
        .then((page) => page.total)
        .catch(() => 0)
    : 0

  /** Keeps every active filter when changing sort or page. Only the named key moves. */
  const urlWith = (changes: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value && !OUTCOME_KEYS.has(key)) search.set(key, value)
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) search.delete(key)
      else search.set(key, String(value))
    }
    return `/findings?${search.toString()}`
  }

  /**
   * The Site column earns its width only when rows can differ in it. With one site, or the list
   * filtered to one, it repeated the same host down every row and pushed Pages and the action out
   * of the frame at 1440px.
   */
  const showSite = sites.length > 1 && !params.siteId

  const hasFilters = Boolean(
    params.q || params.siteId || params.axis || params.severity || params.status || params.fixable,
  )

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Findings"
        title="What needs fixing"
        description="Problems found on your sites, most important first. Open one to see the evidence, or to have the agent fix it with a pull request."
      />

      <FilterBar siteOptions={sites.map((site) => ({ id: site.id, url: site.url }))} />

      <BulkFixOutcome params={params} />
      {params.siteId && <BulkFix siteId={params.siteId} fixable={fixableOpen} />}

      {result.findings.length === 0 ? (
        <EmptyState
          figure="0"
          title={hasFilters ? 'Nothing matches' : 'Nothing to fix yet'}
          action={
            hasFilters ? (
              <Link href="/findings" className="btn btn-secondary">
                Clear the filters
              </Link>
            ) : (
              <Link href="/dashboard" className="btn btn-primary">
                Run an audit
              </Link>
            )
          }
        >
          {hasFilters
            ? 'No findings match these filters.'
            : 'Run an audit and what it finds will be listed here, the most valuable and easiest fixes first.'}
        </EmptyState>
      ) : (
        <>
          <FindingCards findings={result.findings} />
          {/*
            One object: the table and the paging that belongs to it. Below `md` the table is
            replaced by the cards above, and the frame is just the paging strip.
          */}
          <div className="frame mt-3 md:mt-0">
            <FindingsTable
              findings={result.findings}
              sort={sort}
              showSite={showSite}
              sortHref={(key) => urlWith({ sort: key, page: undefined })}
            />

            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hrefFor={(next) => urlWith({ page: next })}
              inFrame
            />
          </div>
        </>
      )}
    </main>
  )
}
