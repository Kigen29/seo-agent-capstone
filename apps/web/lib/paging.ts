/**
 * The arithmetic of paging, in one place.
 *
 * Two things page in this app: lists the server pages through the address (the findings inbox),
 * and lists already in the browser that are simply too long to show at once. They have different
 * controls, links for one and buttons for the other, and must not have different sums.
 */

/** Which page numbers to offer: the ends, the current page and its neighbours, gaps between. */
export function pagesAround(current: number, last: number): (number | 'gap')[] {
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1)

  const wanted = new Set([1, last, current, current - 1, current + 1])
  const pages = [...wanted].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)

  const out: (number | 'gap')[] = []
  for (const [index, page] of pages.entries()) {
    if (index > 0 && page - pages[index - 1]! > 1) out.push('gap')
    out.push(page)
  }
  return out
}

/** The last page there is. Never less than one, so an empty list is still "page 1 of 1". */
export const lastPage = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize))

/**
 * "11 to 20 of 37", as numbers. `first` is zero for an empty list, so a caller can tell "nothing
 * to show" from "showing the first one".
 */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { first: number; shown: number } {
  return {
    first: total === 0 ? 0 : (page - 1) * pageSize + 1,
    shown: Math.min(page * pageSize, total),
  }
}

/** Keep a page number inside what exists, for when a list shrinks under the reader. */
export const clampPage = (page: number, total: number, pageSize: number): number =>
  Math.min(Math.max(1, page), lastPage(total, pageSize))
