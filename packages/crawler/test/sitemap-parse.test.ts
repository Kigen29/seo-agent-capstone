import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_SITEMAP_BYTES, parseSitemap } from '../src/sitemap/parse.js'

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string) => readFileSync(join(here, 'fixtures', `${name}.xml`), 'utf8')

describe('parseSitemap: urlset', () => {
  const sitemap = parseSitemap(load('sitemap-urlset'))

  it('reads the URLs', () => {
    expect(sitemap.kind).toBe('urlset')
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls.map((u) => u.loc)).toEqual([
      'https://example.com/',
      'https://example.com/pricing',
      'https://example.com/blog/why-we-waived-the-inspection',
      'https://example.com/search?q=tiles&page=2',
    ])
  })

  it('unwraps CDATA, which real sitemaps use for URLs with awkward characters', () => {
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls[2]?.loc).toBe('https://example.com/blog/why-we-waived-the-inspection')
  })

  it('decodes XML entities, so the ampersand in a query string survives', () => {
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls[3]?.loc).toBe('https://example.com/search?q=tiles&page=2')
  })

  it('drops a <url> with no <loc>, because it is not a URL', () => {
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls).toHaveLength(4) // the fixture has five <url> elements
  })

  it('keeps lastmod as written rather than guessing at a date format', () => {
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls[0]?.lastmod).toBe('2026-07-01')
    expect(sitemap.urls[1]?.lastmod).toBe('2026-06-15T10:30:00+00:00')
  })

  it('parses priority as a number', () => {
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls[0]?.priority).toBe(1)
    expect(sitemap.urls[1]?.priority).toBe(0.8)
    expect(sitemap.urls[2]?.priority).toBeUndefined()
  })

  it('handles namespace prefixes, so <sm:urlset> is still a urlset', () => {
    const namespaced = parseSitemap(load('sitemap-namespaced'))

    expect(namespaced.kind).toBe('urlset')
    if (namespaced.kind !== 'urlset') throw new Error('expected a urlset')

    expect(namespaced.urls.map((u) => u.loc)).toEqual([
      'https://example.com/gallery',
      'https://example.com/about',
    ])
  })
})

describe('parseSitemap: index', () => {
  it('reads a sitemap index rather than mistaking it for an empty urlset', () => {
    // Mistaking an index for an empty urlset would report a site with a perfectly good
    // sitemap as having no URLs at all, which is a very confident way to be wrong.
    const sitemap = parseSitemap(load('sitemap-index'))

    expect(sitemap.kind).toBe('index')
    if (sitemap.kind !== 'index') throw new Error('expected an index')

    expect(sitemap.sitemaps).toEqual([
      'https://example.com/sitemap-pages.xml',
      'https://example.com/sitemap-posts.xml',
    ])
  })
})

describe('parseSitemap: bad input', () => {
  it('reports unparseable rather than throwing, and never reports "empty"', () => {
    // "We could not read your sitemap" and "your sitemap has no URLs" are different
    // findings with different fixes. Conflating them sends the user chasing a ghost.
    const sitemap = parseSitemap('<urlset><url><loc>https://example.com/</loc>')

    expect(sitemap.kind).toBe('unparseable')
  })

  it('rejects XML that is not a sitemap at all', () => {
    const sitemap = parseSitemap(load('sitemap-not-a-sitemap'))

    expect(sitemap.kind).toBe('unparseable')
    if (sitemap.kind !== 'unparseable') throw new Error('expected unparseable')

    expect(sitemap.reason).toMatch(/urlset|sitemapindex/)
  })

  it('rejects an empty document', () => {
    expect(parseSitemap('').kind).toBe('unparseable')
    expect(parseSitemap('   \n  ').kind).toBe('unparseable')
  })

  it('accepts a valid but genuinely empty urlset, which is a real finding', () => {
    const sitemap = parseSitemap('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />')

    expect(sitemap.kind).toBe('urlset')
    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls).toEqual([])
  })

  it('refuses a sitemap over the 50 MB protocol limit rather than parsing it anyway', () => {
    // Past 50 MB search engines stop reading, so parsing the rest would tell the user
    // about URLs Google will never see. Refusing is the honest answer.
    const padding = ' '.repeat(MAX_SITEMAP_BYTES + 1)
    const sitemap = parseSitemap(
      `<urlset><!--${padding}--><url><loc>https://x.com/</loc></url></urlset>`,
    )

    expect(sitemap.kind).toBe('unparseable')
    if (sitemap.kind !== 'unparseable') throw new Error('expected unparseable')

    expect(sitemap.reason).toContain('50 MB')
  })

  it('handles a single <url> element, which XML makes look like an object not a list', () => {
    const sitemap = parseSitemap('<urlset><url><loc>https://example.com/only</loc></url></urlset>')

    if (sitemap.kind !== 'urlset') throw new Error('expected a urlset')

    expect(sitemap.urls.map((u) => u.loc)).toEqual(['https://example.com/only'])
  })
})
