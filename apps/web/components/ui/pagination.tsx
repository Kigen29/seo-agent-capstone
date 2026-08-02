import Link from 'next/link'

/**
 * Page numbers, as links.
 *
 * Links rather than buttons on purpose: each page is a real URL, so it is shareable, it survives a
 * refresh, the browser's back button does what it should, and the whole control works with
 * JavaScript disabled. A click handler calling `router.push` would have none of those properties
 * and would need a client component to hold state the URL is already holding.
 *
 * The window is deliberately small. A tenant with sixty pages does not need sixty links; they need
 * the first, the last, and a few either side of where they are.
 */
function pagesAround(current: number, last: number): (number | 'gap')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)

  const window = new Set([1, last, current, current - 1, current + 1])
  const pages = [...window].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)

  const out: (number | 'gap')[] = []
  for (const [i, page] of pages.entries()) {
    if (i > 0 && page - pages[i - 1]! > 1) out.push('gap')
    out.push(page)
  }
  return out
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number
  pageSize: number
  total: number
  /** Builds the URL for a page, preserving whatever filters are active. */
  hrefFor: (page: number) => string
}) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const shown = Math.min(page * pageSize, total)

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3"
      style={{ borderColor: 'var(--color-divider)' }}
    >
      {/* The count is the point of paging: "20 of 412" tells you the shape of the backlog. */}
      <p className="text-muted tnum m-0 text-[13px]">
        {total === 0 ? 'Nothing to show' : `${first}–${shown} of ${total}`}
      </p>

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
                className={`btn btn-sm${entry === page ? ' btn-primary' : ' btn-ghost'}`}
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
