import Link from 'next/link'
import { lastPage, pageRange, pagesAround } from '../../lib/paging'

/**
 * Page numbers, as links, for a list the server pages.
 *
 * Links rather than buttons on purpose: each page is a real URL, so it is shareable, it survives a
 * refresh, the browser's back button does what it should, and the whole control works with
 * JavaScript disabled. For a list that is already in the browser and only too long to show at
 * once, use `<DataTable>`, which pages with buttons. Both take their sums from `lib/paging`.
 */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
  inFrame = false,
}: {
  page: number
  pageSize: number
  total: number
  /** Builds the URL for a page, preserving whatever filters are active. */
  hrefFor: (page: number) => string
  /** Rendered as the footer strip of a `.frame`, under the table it pages. */
  inFrame?: boolean
}) {
  const last = lastPage(total, pageSize)
  const { first, shown } = pageRange(page, pageSize, total)

  return (
    <nav
      aria-label="Pagination"
      className={
        inFrame
          ? 'panel-foot'
          : 'mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3'
      }
      style={inFrame ? undefined : { borderColor: 'var(--color-divider)' }}
    >
      {/* The count is the point of paging: "20 of 412" tells you the shape of the backlog. */}
      <div className="text-muted tnum text-[13px]">
        {total === 0 ? 'Nothing to show' : `${first}–${shown} of ${total}`}
      </div>

      {last > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {page > 1 && (
            <Link href={hrefFor(page - 1)} className="btn btn-ghost btn-sm" rel="prev">
              &larr; Previous
            </Link>
          )}

          {pagesAround(page, last).map((entry, i) =>
            entry === 'gap' ? (
              <span key={`gap-${i}`} className="text-subtle px-1 text-[13px]" aria-hidden="true">
                &hellip;
              </span>
            ) : (
              <Link
                key={entry}
                href={hrefFor(entry)}
                className={`btn btn-sm${entry === page ? ' btn-secondary' : ' btn-ghost'}`}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
              >
                {entry}
              </Link>
            ),
          )}

          {page < last && (
            <Link href={hrefFor(page + 1)} className="btn btn-ghost btn-sm" rel="next">
              Next &rarr;
            </Link>
          )}
        </div>
      )}
    </nav>
  )
}
