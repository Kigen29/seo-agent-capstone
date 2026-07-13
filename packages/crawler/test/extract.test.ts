import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractPage } from '../src/page/extract.js'

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string) => readFileSync(join(here, 'fixtures', `${name}.html`), 'utf8')

const BASE = 'https://example.com/tiles/pricing'
const page = extractPage(load('page-full'), BASE)

describe('extractPage: head', () => {
  it('trims the title', () => {
    expect(page.title).toBe('Tile prices in Nairobi')
  })

  it('reads the meta description', () => {
    expect(page.metaDescription).toBe('What tiles actually cost in Nairobi in 2026.')
  })

  it('resolves a relative canonical to absolute', () => {
    // A relative canonical is legal and is a reliable source of bugs. Resolving it here
    // means every rule downstream compares like with like.
    expect(page.canonical).toBe('https://example.com/tiles/pricing')
  })

  it('parses meta robots', () => {
    expect(page.metaRobots.index).toBe(true)
    expect(page.metaRobots.follow).toBe(true)
    expect(page.metaRobots.directives).toEqual(['index', 'follow'])
  })

  it('collects hreflang, resolving relative hrefs', () => {
    expect(page.hreflang).toEqual([
      { hreflang: 'en-ke', href: 'https://example.com/tiles/pricing' },
      { hreflang: 'sw-ke', href: 'https://example.com/sw/tiles/pricing' },
      { hreflang: 'x-default', href: 'https://example.com/tiles/pricing' },
    ])
  })
})

describe('extractPage: meta robots defaults', () => {
  it('treats an absent robots tag as indexable, because that is the default', () => {
    // Assuming otherwise would report half the web as noindexed.
    const bare = extractPage('<html><head></head><body>x</body></html>', BASE)

    expect(bare.metaRobots.raw).toBeNull()
    expect(bare.metaRobots.index).toBe(true)
    expect(bare.metaRobots.follow).toBe(true)
  })

  it.each([
    ['noindex', false, true],
    ['noindex, nofollow', false, false],
    ['NOINDEX', false, true],
    ['none', false, false],
  ])('reads "%s" as index=%s follow=%s', (content, index, follow) => {
    const html = `<html><head><meta name="robots" content="${content}"></head><body>x</body></html>`
    const result = extractPage(html, BASE)

    expect(result.metaRobots.index).toBe(index)
    expect(result.metaRobots.follow).toBe(follow)
  })
})

describe('extractPage: headings', () => {
  it('records every heading with its level, so a skipped level is detectable', () => {
    expect(page.headings).toEqual([
      { level: 1, text: 'Tile prices in Nairobi' },
      { level: 2, text: 'What you will actually pay' },
      { level: 4, text: 'Skipped a level on purpose' },
    ])
  })

  it('exposes h1s separately, because missing or duplicate h1 is its own rule', () => {
    expect(page.h1s).toEqual(['Tile prices in Nairobi'])
  })
})

describe('extractPage: links', () => {
  it('resolves relative hrefs and marks internal links', () => {
    const porcelain = page.links.find((l) => l.href === '/tiles/porcelain')

    expect(porcelain?.resolved).toBe('https://example.com/tiles/porcelain')
    expect(porcelain?.internal).toBe(true)
    expect(porcelain?.anchorText).toBe('Porcelain tiles')
  })

  it('marks an off-host link as external', () => {
    const competitor = page.links.find((l) => l.href.includes('competitor'))

    expect(competitor?.internal).toBe(false)
    expect(competitor?.nofollow).toBe(true)
    expect(competitor?.rel).toEqual(['nofollow', 'noopener'])
  })

  it('excludes mailto, tel, javascript and bare fragments, which are not pages', () => {
    // Letting any of these into the frontier means the crawler tries to fetch them.
    const hrefs = page.links.map((l) => l.href)

    expect(hrefs).not.toContain('mailto:sales@example.com')
    expect(hrefs).not.toContain('tel:+254700000000')
    expect(hrefs).not.toContain('javascript:void(0)')
    expect(hrefs).not.toContain('#top')
  })

  it('strips the fragment when resolving, so /a and /a#reviews are one page', () => {
    const reviews = page.links.find((l) => l.href === '/tiles/porcelain#reviews')

    expect(reviews?.resolved).toBe('https://example.com/tiles/porcelain')
  })
})

describe('extractPage: images', () => {
  it('distinguishes a missing alt from an empty one', () => {
    // These are NOT the same. An empty alt is the correct markup for a decorative image.
    // A missing alt is a defect. A rule that conflates them nags people who did it right.
    const hero = page.images.find((i) => i.src === '/hero.jpg')
    const decorative = page.images.find((i) => i.src === '/decorative-swirl.svg')
    const gallery = page.images.find((i) => i.src === '/gallery/1.jpg')

    expect(hero?.alt).toBe('A tiled kitchen floor')
    expect(decorative?.alt).toBe('') // present and deliberately empty
    expect(gallery?.alt).toBeNull() // absent entirely
  })

  it('captures the attributes the Core Web Vitals fixers need', () => {
    const hero = page.images.find((i) => i.src === '/hero.jpg')
    const gallery = page.images.find((i) => i.src === '/gallery/1.jpg')

    expect(hero?.width).toBe(1200)
    expect(hero?.height).toBe(600)
    expect(hero?.fetchPriority).toBe('high')
    expect(gallery?.loading).toBe('lazy')
    expect(gallery?.width).toBeUndefined() // no dimensions, so a CLS risk
  })
})

describe('extractPage: JSON-LD', () => {
  it('parses valid blocks', () => {
    expect(page.jsonLd).toEqual([
      { '@context': 'https://schema.org', '@type': 'Product', name: 'Porcelain tile' },
    ])
  })

  it('records a malformed block instead of silently dropping it', () => {
    // Google ignores broken JSON-LD without complaint, so the author believes they have
    // structured data and they do not. Recording the error is the entire point.
    expect(page.jsonLdErrors).toHaveLength(1)
  })
})

describe('extractPage: text', () => {
  it('excludes script and style content from the word count', () => {
    // Otherwise an inline analytics blob inflates the count and hides thin content.
    expect(page.text).not.toContain('window.analytics')
    expect(page.text).not.toContain('color: red')
    expect(page.text).toContain('Porcelain runs from KES 1,200')
  })

  it('counts words', () => {
    expect(page.wordCount).toBeGreaterThan(10)
  })
})
