import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compareRenders } from '../src/page/render.js'

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string) => readFileSync(join(here, 'fixtures', `${name}.html`), 'utf8')

const URL_ = 'https://example.com/tiles/pricing'

describe('compareRenders', () => {
  it('catches a page that only becomes a page once the bundle runs', () => {
    const result = compareRenders(load('page-csr-shell'), load('page-csr-rendered'), URL_)

    expect(result.preJsWordCount).toBe(0)
    expect(result.postJsWordCount).toBeGreaterThan(50)
    expect(result.likelyCsrOnly).toBe(true)
    expect(result.preJsH1Count).toBe(0)
    expect(result.postJsH1Count).toBe(1)
  })

  it('does not flag a server-rendered page that hydrates', () => {
    // The content is already in the HTML; JavaScript only attaches behaviour. This is
    // the correct pattern and must never be reported as a problem.
    const html = load('page-full')
    const result = compareRenders(html, html, URL_)

    expect(result.ratio).toBe(1)
    expect(result.likelyCsrOnly).toBe(false)
  })

  it('does not judge a genuinely short page', () => {
    // A login screen or a redirect stub has few words by design. Without a floor, the
    // ratio test would fire on a handful of words and produce a confident finding about
    // nothing.
    const shell = '<html><body><div id="root"></div></body></html>'
    const rendered = '<html><body><div id="root"><h1>Sign in</h1><p>Email</p></div></body></html>'

    const result = compareRenders(shell, rendered, URL_)

    expect(result.postJsWordCount).toBeLessThan(50)
    expect(result.likelyCsrOnly).toBe(false)
  })

  it('does not flag a page where JavaScript adds a little to a lot', () => {
    const base = `<html><body><h1>Tiles</h1><p>${'word '.repeat(200)}</p>`
    const result = compareRenders(
      `${base}</body></html>`,
      `${base}<p>Related posts</p></body></html>`,
      URL_,
    )

    expect(result.ratio).toBeGreaterThan(0.9)
    expect(result.likelyCsrOnly).toBe(false)
  })
})
