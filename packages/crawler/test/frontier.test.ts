import { describe, expect, it } from 'vitest'
import { Frontier, normaliseUrl } from '../src/crawl/frontier.js'

describe('normaliseUrl', () => {
  it('strips the fragment, which is never sent to the server', () => {
    expect(normaliseUrl('https://example.com/a#top')).toBe('https://example.com/a')
  })

  it('strips tracking parameters, which spawn infinite URLs for one page', () => {
    // Without this, one shared link can eat the entire crawl budget on a single page.
    expect(normaliseUrl('https://example.com/a?utm_source=x&utm_medium=y&id=7')).toBe(
      'https://example.com/a?id=7',
    )
    expect(normaliseUrl('https://example.com/a?fbclid=abc')).toBe('https://example.com/a')
  })

  it('keeps meaningful query parameters, because they are different pages', () => {
    expect(normaliseUrl('https://example.com/search?q=tiles&page=2')).toBe(
      'https://example.com/search?q=tiles&page=2',
    )
  })

  it('lowercases the host but not the path, because paths are case-sensitive', () => {
    expect(normaliseUrl('https://EXAMPLE.com/Tiles')).toBe('https://example.com/Tiles')
  })

  it('drops the default port', () => {
    expect(normaliseUrl('https://example.com:443/a')).toBe('https://example.com/a')
    expect(normaliseUrl('http://example.com:80/a')).toBe('http://example.com/a')
  })

  it('resolves against a base', () => {
    expect(normaliseUrl('/b', 'https://example.com/a/c')).toBe('https://example.com/b')
  })

  it('rejects anything that is not http or https', () => {
    expect(normaliseUrl('mailto:x@example.com')).toBeUndefined()
    expect(normaliseUrl('ftp://example.com/a')).toBeUndefined()
    expect(normaliseUrl('not a url')).toBeUndefined()
  })
})

describe('Frontier', () => {
  it('starts with the seed', () => {
    const frontier = new Frontier('https://example.com/')

    expect(frontier.next()).toEqual({ url: 'https://example.com/', depth: 0 })
  })

  it('rejects an invalid seed loudly rather than crawling nothing', () => {
    expect(() => new Frontier('not a url')).toThrow(/not a valid/)
  })

  it('queues a page linked from fifty places exactly once', () => {
    const frontier = new Frontier('https://example.com/')
    frontier.next()

    const added = frontier.add(
      ['https://example.com/a', 'https://example.com/a#x', 'https://example.com/a?utm_source=y'],
      1,
    )

    expect(added).toBe(1)
    expect(frontier.pendingCount).toBe(1)
  })

  it('never re-queues the seed', () => {
    const frontier = new Frontier('https://example.com/')

    expect(frontier.add(['https://example.com/'], 1)).toBe(0)
  })

  it('stays on the seed host, because following every outbound link crawls the web', () => {
    const frontier = new Frontier('https://example.com/')

    expect(frontier.add(['https://competitor.example/a'], 1)).toBe(0)
  })

  it('follows off-host links when told to', () => {
    const frontier = new Frontier('https://example.com/', { sameHostOnly: false })

    expect(frontier.add(['https://competitor.example/a'], 1)).toBe(1)
  })

  it('is breadth-first, so a page budget is spent on the shallow pages that matter', () => {
    const frontier = new Frontier('https://example.com/')
    frontier.next()

    frontier.add(['https://example.com/a', 'https://example.com/b'], 1)
    frontier.add(['https://example.com/deep'], 2)

    expect(frontier.next()?.url).toBe('https://example.com/a')
    expect(frontier.next()?.url).toBe('https://example.com/b')
    expect(frontier.next()?.url).toBe('https://example.com/deep')
  })

  it('stops handing out work once the page budget is spent', () => {
    const frontier = new Frontier('https://example.com/', { maxPages: 2 })
    frontier.add(['https://example.com/a', 'https://example.com/b'], 1)

    frontier.complete(frontier.next()!.url)
    frontier.complete(frontier.next()!.url)

    expect(frontier.budgetExhausted).toBe(true)
    expect(frontier.next()).toBeUndefined()
  })
})

describe('Frontier: resumability', () => {
  it('resumes at page 48 after dying at page 47, rather than starting again', () => {
    // The acceptance criterion, and the reason state is snapshotted after every page:
    // restarting a crawl from scratch re-hammers a site that already served us 47 pages.
    const original = new Frontier('https://example.com/')
    original.add(
      Array.from({ length: 60 }, (_, i) => `https://example.com/p${i}`),
      1,
    )

    for (let i = 0; i < 47; i += 1) {
      const entry = original.next()
      if (!entry) throw new Error('ran out of work early')
      original.complete(entry.url)
    }

    const state = JSON.parse(JSON.stringify(original.toState())) // survives a round trip
    const resumed = Frontier.fromState('https://example.com/', state)

    expect(resumed.visitedCount).toBe(47)
    expect(resumed.next()?.url).toBe('https://example.com/p46')
  })

  it('does not re-crawl a page that was already completed', () => {
    const original = new Frontier('https://example.com/')
    original.add(['https://example.com/a'], 1)

    original.complete(original.next()!.url) // the seed
    original.complete(original.next()!.url) // /a

    const resumed = Frontier.fromState('https://example.com/', original.toState())

    expect(resumed.next()).toBeUndefined()
    expect(resumed.add(['https://example.com/a'], 1)).toBe(0)
  })

  it('keeps the seen set, so resuming does not re-queue known URLs', () => {
    const original = new Frontier('https://example.com/')
    original.add(['https://example.com/a', 'https://example.com/b'], 1)

    const resumed = Frontier.fromState('https://example.com/', original.toState())

    expect(resumed.pendingCount).toBe(3)
    expect(resumed.add(['https://example.com/a'], 1)).toBe(0)
  })
})
