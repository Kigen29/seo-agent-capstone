import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { SitemapEntryFixer } from '../src/fixers/sitemap-entry.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

const sitemapXml = (...urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n${urls
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join('\n')}\n</urlset>\n`

/** A TECH-004 finding for a listed URL that redirects, as the rule records it. */
function redirects(overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'TECH-004',
    title: 'Sitemap lists https://ex.com/old, which redirects to https://ex.com/new',
    affectedUrls: ['https://ex.com/old'],
    evidence: {
      kind: 'http',
      url: 'https://ex.com/new',
      status: 200,
      redirectChain: ['https://ex.com/old'],
      observedAt: '2026-08-23T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

/** The same rule firing for a URL that 404s: no redirect chain, non-200 status. */
function gone(): Finding {
  return makeFinding({
    ruleId: 'TECH-004',
    title: 'Sitemap lists https://ex.com/gone, which returns 404',
    affectedUrls: ['https://ex.com/gone'],
    evidence: {
      kind: 'http',
      url: 'https://ex.com/gone',
      status: 404,
      redirectChain: [],
      observedAt: '2026-08-23T00:00:00.000Z',
      source: 'crawler',
    },
  })
}

const fixer = new SitemapEntryFixer()
const generate = (files: Record<string, string>, finding = redirects()) =>
  fixer.generate({ finding, framework: 'next', read: reader(files) })

describe('SitemapEntryFixer', () => {
  it('rewrites the listed URL to the address it redirects to', async () => {
    const result = await generate({
      'public/sitemap.xml': sitemapXml('https://ex.com/', 'https://ex.com/old'),
    })

    expect(result?.files[0]?.content).toBe(sitemapXml('https://ex.com/', 'https://ex.com/new'))
  })

  it('leaves every other entry untouched', async () => {
    // Rewriting through an XML parser would reformat the whole file and bury the one line that
    // changed in a diff nobody can review.
    const result = await generate({
      'sitemap.xml': sitemapXml('https://ex.com/a', 'https://ex.com/old', 'https://ex.com/b'),
    })

    expect(result?.files[0]?.content).toContain('<loc>https://ex.com/a</loc>')
    expect(result?.files[0]?.content).toContain('<loc>https://ex.com/b</loc>')
    expect(result?.files[0]?.content).not.toContain('https://ex.com/old')
  })

  it('declines a 404, because removing the entry hides a dead page rather than fixing it', async () => {
    // Either the page should exist and is missing, or it should not be listed. An agent cannot
    // tell which, and picking one quietly deletes the evidence of the other.
    expect(fixer.canFix(gone())).toBe(false)
    expect(
      await generate({ 'public/sitemap.xml': sitemapXml('https://ex.com/gone') }, gone()),
    ).toBeNull()
  })

  it('declines a noindexed entry, whose contradiction belongs to TECH-005', async () => {
    const noindexed = redirects({
      evidence: {
        kind: 'http',
        url: 'https://ex.com/hidden',
        status: 200,
        redirectChain: [],
        observedAt: '2026-08-23T00:00:00.000Z',
        source: 'crawler',
      },
      affectedUrls: ['https://ex.com/hidden'],
    })

    // No redirect chain: either the sitemap is wrong to list it or the noindex is wrong, and
    // that is a human's call either way.
    expect(fixer.canFix(noindexed)).toBe(false)
  })

  it('declines a generated sitemap, which is code rather than markup', async () => {
    const result = await generate({
      'app/sitemap.ts':
        'export default function sitemap() { return [{ url: "https://ex.com/old" }] }',
    })

    expect(result).toBeNull()
  })

  it('declines when no committed sitemap contains the URL', async () => {
    const result = await generate({ 'public/sitemap.xml': sitemapXml('https://ex.com/other') })

    expect(result).toBeNull()
  })

  it('declines when the redirect lands somewhere that is not a 200', async () => {
    const chained = redirects({
      evidence: {
        kind: 'http',
        url: 'https://ex.com/new',
        status: 404,
        redirectChain: ['https://ex.com/old'],
        observedAt: '2026-08-23T00:00:00.000Z',
        source: 'crawler',
      },
    })

    // Listing a URL that redirects to a 404 would replace one broken entry with another.
    expect(fixer.canFix(chained)).toBe(false)
  })

  it('says the redirect itself is untouched, so old links keep working', async () => {
    const result = await generate({ 'public/sitemap.xml': sitemapXml('https://ex.com/old') })

    expect(result?.expectedEffect).toContain('redirect itself is untouched')
  })

  it('only claims TECH-004', () => {
    expect(fixer.canFix(redirects({ ruleId: 'TECH-007' }))).toBe(false)
  })
})
