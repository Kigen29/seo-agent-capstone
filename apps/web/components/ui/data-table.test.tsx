import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { clampPage, lastPage, pageRange, pagesAround } from '../../lib/paging'
import { DataTable, type DataTableRow } from './data-table'

/**
 * The shared table, and the sums under it.
 *
 * Every list in the app goes through this one component, so a wrong count or a missing heading
 * here is wrong everywhere at once. The first page is what the server sends, so it is what can be
 * checked without a browser; moving between pages is covered in the browser suite.
 */
const rows = (count: number): DataTableRow[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `site-${index + 1}`,
    cells: [`site-${index + 1}.example`, String(index + 1)],
  }))

const table = (count: number, pageSize = 10) =>
  renderToStaticMarkup(
    <DataTable
      label="sites that mention you"
      columns={[{ header: 'Site' }, { header: 'Pages', align: 'end' }]}
      rows={rows(count)}
      pageSize={pageSize}
    />,
  )

describe('DataTable', () => {
  it('shows the first page and says how many there are in all', () => {
    const html = table(37)

    expect(html).toContain('site-1.example')
    expect(html).toContain('site-10.example')
    expect(html).not.toContain('site-11.example')
    // An en dash between the numbers, which is what a range takes.
    expect(html).toContain('1–10 of 37')
  })

  it('gives a short list no paging controls at all', () => {
    const html = table(4)

    expect(html).toContain('site-4.example')
    expect(html).not.toContain('Previous')
    expect(html).not.toContain(' of 4')
  })

  it('pages exactly at the size, not one row early', () => {
    expect(table(10)).not.toContain('Previous')
    expect(table(11)).toContain('1–10 of 11')
  })

  it('names itself and every column for a screen reader', () => {
    const html = table(3)

    expect(html).toContain('<caption class="sr-only">sites that mention you</caption>')
    expect(html.match(/scope="col"/g)).toHaveLength(2)
  })

  it('keeps a hidden heading readable, for a column of buttons', () => {
    const html = renderToStaticMarkup(
      <DataTable
        label="competitors"
        columns={[{ header: 'Competitor' }, { header: 'Actions', hideHeader: true, align: 'end' }]}
        rows={[{ key: 'a', cells: ['a.example', 'Remove'] }]}
      />,
    )

    expect(html).toContain('<span class="sr-only">Actions</span>')
  })

  it('lines figures up at the end of their column', () => {
    expect(table(1)).toContain('<td class="num">1</td>')
  })

  it('cannot go back from the first page', () => {
    expect(table(30)).toMatch(/<button[^>]*disabled=""[^>]*>← Previous<\/button>/)
  })

  it('renders the empty message when there is nothing, and nothing when there is no message', () => {
    const columns = [{ header: 'Site' }]

    expect(
      renderToStaticMarkup(<DataTable label="x" columns={columns} rows={[]} empty="None yet." />),
    ).toBe('None yet.')
    expect(renderToStaticMarkup(<DataTable label="x" columns={columns} rows={[]} />)).toBe('')
  })
})

describe('paging', () => {
  it('counts pages, and never fewer than one', () => {
    expect(lastPage(0, 10)).toBe(1)
    expect(lastPage(10, 10)).toBe(1)
    expect(lastPage(11, 10)).toBe(2)
  })

  it('says which rows a page holds', () => {
    expect(pageRange(1, 10, 37)).toEqual({ first: 1, shown: 10 })
    expect(pageRange(4, 10, 37)).toEqual({ first: 31, shown: 37 })
    expect(pageRange(1, 10, 0)).toEqual({ first: 0, shown: 0 })
  })

  it('brings a page back inside the list when the list has shrunk', () => {
    expect(clampPage(4, 37, 10)).toBe(4)
    expect(clampPage(4, 12, 10)).toBe(2)
    expect(clampPage(0, 12, 10)).toBe(1)
    expect(clampPage(3, 0, 10)).toBe(1)
  })

  it('offers every page when there are few, and the ends and neighbours when there are many', () => {
    expect(pagesAround(2, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pagesAround(1, 20)).toEqual([1, 2, 'gap', 20])
    expect(pagesAround(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20])
    expect(pagesAround(20, 20)).toEqual([1, 'gap', 19, 20])
  })
})
