import type { FindingPage } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { SeverityBadge } from '@/components/severity'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { FilterBar } from './filter-bar'
import { AXIS_LABEL, STATUS_LABEL } from './labels'

export const dynamic = 'force-dynamic'

/** Columns the table offers to sort by, and what each is called in the header. */
const SORTS = [
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'title', label: 'Finding' },
  { key: 'axis', label: 'Axis' },
] as const

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

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

  /** Keeps every active filter when changing sort or page. Only the named key moves. */
  const urlWith = (changes: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value)
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) search.delete(key)
      else search.set(key, String(value))
    }
    return `/findings?${search.toString()}`
  }

  const hasFilters = Boolean(
    params.q || params.siteId || params.axis || params.severity || params.status || params.fixable,
  )

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Findings"
        title="Everything out of true, in one list."
        description="Sorted by impact over effort, so the top of the list is what to do on Monday."
      />

      <FilterBar siteOptions={sites.map((site) => ({ id: site.id, url: site.url }))} />

      {result.findings.length === 0 ? (
        <EmptyState
          figure="0"
          title="Nothing out of true here"
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
            : 'Run an audit and findings will land here, sorted by impact over effort.'}
        </EmptyState>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  {SORTS.filter((column) => column.key !== 'priority').map((column) => (
                    <th key={column.key} aria-sort={sort === column.key ? 'descending' : 'none'}>
                      {/*
                          Sortable headers, which this table did not have: the order was fixed by
                          priority score with no way to ask for anything else.
                        */}
                      <SortLink
                        href={urlWith({ sort: column.key, page: undefined })}
                        active={sort === column.key}
                        label={column.label}
                      />
                    </th>
                  ))}
                  <th>Site</th>
                  <th>Status</th>
                  <th aria-sort={sort === 'priority' ? 'descending' : 'none'}>
                    <SortLink
                      href={urlWith({ sort: 'priority', page: undefined })}
                      active={sort === 'priority'}
                      label="Priority"
                    />
                  </th>
                  <th>Pages</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.findings.map((finding) => {
                  const status = STATUS_LABEL[finding.status]
                  return (
                    <tr key={finding.rowId}>
                      <td>
                        <span className={finding.fixable ? 'tag tag-outline' : 'tag tag-neutral'}>
                          {finding.fixable ? 'Fixable' : 'Needs input'}
                        </span>
                      </td>
                      <td>
                        <SeverityBadge severity={finding.severity} />
                      </td>
                      <td>{finding.title}</td>
                      <td>{AXIS_LABEL[finding.axis] ?? finding.axis}</td>
                      <td className="text-muted">{hostOf(finding.siteUrl)}</td>
                      <td className="whitespace-nowrap">
                        {/*
                            Status was fetched and never rendered, so a finding with a pull request
                            already open looked exactly like one nobody had touched. In a triage
                            list that is the difference between work to do and work in flight.
                          */}
                        <span className={status.className}>{status.label}</span>
                        {/*
                            A failed fix attempt leaves the finding open, which is correct: it
                            still needs doing. But "open" alone made a finding whose fix had been
                            tried and failed identical to one nobody had touched, which is the
                            same mistake as not rendering status at all, one level down.
                          */}
                        {finding.fixFailed && (
                          <span
                            className="tag tag-critical ml-1"
                            title="The last fix attempt failed. Open the finding for the reason."
                          >
                            Fix failed
                          </span>
                        )}
                      </td>
                      <td className="tnum text-muted">{finding.estimatedImpact}</td>
                      <td className="tnum text-muted">{finding.affectedUrlCount}</td>
                      <td className="whitespace-nowrap">
                        <Link href={`/findings/${finding.rowId}`}>View &rarr;</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            hrefFor={(next) => urlWith({ page: next })}
          />
        </>
      )}
    </main>
  )
}

/** A column header that is also the control for sorting by it. */
function SortLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      style={{ color: active ? 'var(--color-accent-700)' : 'inherit' }}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active ? ' ↓' : ''}
    </Link>
  )
}
