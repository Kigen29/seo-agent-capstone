import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoogleCallbackNote } from '../google-connection'
import { RepoCallback } from '../repo-callback'
import { OutcomeNote, outcomeFor, type Outcome } from './outcome-note'

/**
 * The banner shown after an action that left the page and came back.
 *
 * The status it shows comes from the address bar, which anybody can type into. So the first
 * thing checked is that a status the page does not know shows nothing, including the ones that
 * are not statuses at all but names every JavaScript object already has.
 */
const TABLE: Record<string, Outcome> = {
  done: { tone: 'ok', title: 'It worked', detail: 'And here is what happens next.' },
  yours: { tone: 'warn', title: 'Something to fix' },
}

describe('outcomeFor', () => {
  it('finds a status the page knows', () => {
    expect(outcomeFor(TABLE, 'done')?.title).toBe('It worked')
  })

  it('shows nothing for a status it does not know, or none at all', () => {
    expect(outcomeFor(TABLE, 'something-else')).toBeUndefined()
    expect(outcomeFor(TABLE, '')).toBeUndefined()
    expect(outcomeFor(TABLE, undefined)).toBeUndefined()
  })

  it('is not fooled by the names every object has', () => {
    // A plain lookup returns a function for these, and the page then drew an empty banner.
    for (const status of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(outcomeFor(TABLE, status)).toBeUndefined()
    }
  })
})

describe('OutcomeNote', () => {
  it('says what happened, then what it means', () => {
    const html = renderToStaticMarkup(<OutcomeNote outcome={TABLE.done} />)

    expect(html).toContain('It worked')
    expect(html).toContain('And here is what happens next.')
    expect(html.indexOf('It worked')).toBeLessThan(html.indexOf('And here'))
  })

  it('interrupts a screen reader only for something to act on', () => {
    expect(renderToStaticMarkup(<OutcomeNote outcome={TABLE.done} />)).toContain('role="status"')
    expect(renderToStaticMarkup(<OutcomeNote outcome={TABLE.yours} />)).toContain('role="alert"')
    expect(
      renderToStaticMarkup(<OutcomeNote outcome={{ tone: 'error', title: 'Ours' }} />),
    ).toContain('role="alert"')
  })

  it('renders nothing when there is nothing to say', () => {
    expect(renderToStaticMarkup(<OutcomeNote outcome={undefined} />)).toBe('')
    expect(renderToStaticMarkup(<OutcomeNote outcome={null} />)).toBe('')
  })
})

describe('the banners that read their status from the address', () => {
  it('show a known outcome with a title and a way forward', () => {
    const google = renderToStaticMarkup(<GoogleCallbackNote callback="connected" />)
    const repo = renderToStaticMarkup(<RepoCallback callback="norepo" />)

    expect(google).toContain('Search Console is connected')
    expect(repo).toContain('No repository was chosen')
    expect(repo).toContain('select the one that holds this site')
  })

  it('show nothing for a status somebody typed', () => {
    for (const status of ['constructor', '__proto__', 'made-up', '']) {
      expect(renderToStaticMarkup(<GoogleCallbackNote callback={status} />)).toBe('')
      expect(renderToStaticMarkup(<RepoCallback callback={status} />)).toBe('')
    }
  })

  it('never calls a cancelled consent an error', () => {
    // The person changed their mind. That is information, and nothing went wrong.
    expect(renderToStaticMarkup(<GoogleCallbackNote callback="declined" />)).toContain('note-info')
    expect(renderToStaticMarkup(<RepoCallback callback="declined" />)).toContain('note-info')
  })
})
