'use client'

import { useId, useState, type ReactNode } from 'react'
import { clampPage, lastPage, pageRange, pagesAround } from '../../lib/paging'

/**
 * A table of things, a page at a time. The one way a list of records is shown.
 *
 * Every page used to draw its lists by hand: a `<ul>` of bordered rows here, a `<table>` there,
 * a "show 12 more" disclosure somewhere else, each with its own markup for the same idea. A long
 * list then simply ran down the page, and a reader looking for the section underneath it had to
 * scroll past forty rows to find it.
 *
 * So: columns across the top, so a row can be read by what each cell is; ten rows at a time, so
 * the page keeps its shape whatever the count; and the count itself in the footer, because
 * "11 to 20 of 37" tells you the size of a thing before you have read any of it.
 *
 * Cells are passed already rendered. That is what lets a server-rendered page and an interactive
 * panel both use this: a function cannot be handed from the server to the browser, and a
 * rendered cell can. It also keeps this component ignorant of what any row means.
 *
 * A list that fits on one page gets no footer at all. Paging controls under five rows are noise.
 */
export interface DataTableColumn {
  /** What the column is. Always given, even when hidden, so a screen reader can name the cell. */
  header: ReactNode
  /** `end` for figures and for the action column, so numbers line up and actions sit at the edge. */
  align?: 'start' | 'end'
  /** Keep the heading for screen readers only. For a column of buttons that needs no title. */
  hideHeader?: boolean
  /** Extra classes for every cell in the column, for a width or for wrapping. */
  className?: string
}

export interface DataTableRow {
  /** Stable and unique in this table: a domain, an id, a URL. Never an index. */
  key: string
  /** One per column, in order. */
  cells: ReactNode[]
}

export function DataTable({
  label,
  columns,
  rows,
  pageSize = 10,
  empty,
  stack = false,
  className = '',
}: {
  /** What this is a table of, for screen readers. Not shown. */
  label: string
  columns: DataTableColumn[]
  rows: DataTableRow[]
  pageSize?: number
  /** Shown in place of the table when there are no rows. Without it, nothing is rendered. */
  empty?: ReactNode
  /**
   * On a phone, lay each row out as a block of labelled lines instead of scrolling sideways.
   * For a table whose last column is the thing to press: an action a thumb has to scroll to
   * find is an action most people never see.
   */
  stack?: boolean
  className?: string
}) {
  const [wanted, setPage] = useState(1)
  const status = useId()

  if (rows.length === 0) return empty ? <>{empty}</> : null

  // Clamped on every render, not stored: when a row is removed the list can shrink under the
  // reader, and the last page they were on may no longer exist.
  const page = clampPage(wanted, rows.length, pageSize)
  const last = lastPage(rows.length, pageSize)
  const { first, shown } = pageRange(page, pageSize, rows.length)
  const visible = rows.slice(first - 1, shown)

  const cellClass = (column: DataTableColumn) =>
    [column.align === 'end' ? 'num' : '', column.className ?? ''].join(' ').trim() || undefined

  return (
    <div className={`frame ${className}`.trim()}>
      <div className="table-scroll">
        <table
          className={stack ? 'table table-stack' : 'table'}
          aria-describedby={last > 1 ? status : undefined}
        >
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index} scope="col" className={cellClass(column)}>
                  {column.hideHeader ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key}>
                {columns.map((column, index) => (
                  <td
                    key={index}
                    className={cellClass(column)}
                    // Read by the stacked layout, which has no header row to name the cell.
                    data-label={
                      stack && !column.hideHeader && typeof column.header === 'string'
                        ? column.header
                        : undefined
                    }
                  >
                    {row.cells[index]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {last > 1 && (
        <nav aria-label={`Pages of ${label}`} className="panel-foot">
          {/* Announced when it changes, so paging is not silent to somebody who cannot see it. */}
          <div id={status} className="text-muted tnum text-[13px]" aria-live="polite">
            {first}&ndash;{shown} of {rows.length}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              &larr; Previous
            </button>

            {pagesAround(page, last).map((entry, index) =>
              entry === 'gap' ? (
                <span
                  key={`gap-${index}`}
                  className="text-subtle px-1 text-[13px]"
                  aria-hidden="true"
                >
                  &hellip;
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  className={`btn btn-sm${entry === page ? ' btn-secondary' : ' btn-ghost'}`}
                  aria-current={entry === page ? 'page' : undefined}
                  aria-label={`Page ${entry}`}
                  onClick={() => setPage(entry)}
                >
                  {entry}
                </button>
              ),
            )}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(page + 1)}
              disabled={page === last}
            >
              Next &rarr;
            </button>
          </div>
        </nav>
      )}
    </div>
  )
}
