import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { SitemapDeclarationFixer } from '../src/fixers/sitemap-declaration.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** A TECH-003 finding, as the rule records it: the seed is the affected URL. */
function noSitemapDeclared(overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'TECH-003',
    title: 'No sitemap is declared in robots.txt',
    affectedUrls: ['https://ex.com/'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: '/robots.txt',
      snippet: 'robots.txt exists but contains no Sitemap: directive.',
      observedAt: '2026-08-23T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

const fixer = new SitemapDeclarationFixer()
const generate = (files: Record<string, string>, finding = noSitemapDeclared()) =>
  fixer.generate({ finding, framework: 'next', read: reader(files) })

describe('SitemapDeclarationFixer', () => {
  it('appends the declaration to an existing robots.txt', async () => {
    const result = await generate({
      'public/robots.txt': 'User-agent: *\nAllow: /\n',
      'public/sitemap.xml': '<urlset />',
    })

    expect(result?.files).toEqual([
      {
        path: 'public/robots.txt',
        content: 'User-agent: *\nAllow: /\n\nSitemap: https://ex.com/sitemap.xml\n',
      },
    ])
  })

  it('leaves every existing crawl rule byte-for-byte', async () => {
    // Appending is the whole safety argument: `Sitemap` is group-independent, so its position
    // carries no meaning, and a careless robots edit can deindex a site.
    const original =
      '# hand written\nUser-agent: Googlebot\nDisallow: /admin\n\nUser-agent: *\nAllow: /\n'
    const result = await generate({
      'robots.txt': original,
      'sitemap.xml': '<urlset />',
    })

    expect(result?.files[0]?.content.startsWith(original)).toBe(true)
  })

  it('refuses when no sitemap exists, rather than pointing robots.txt at a 404', async () => {
    // The rule fires on a missing *declaration*, which says nothing about whether a sitemap
    // exists. The crawler cannot help: it only expands sitemaps robots.txt already declared, so
    // it has never looked. Guessing would turn a missing declaration into a broken one.
    const result = await generate({ 'public/robots.txt': 'User-agent: *\nAllow: /\n' })

    expect(result).toBeNull()
  })

  it('accepts a framework-generated sitemap with nothing committed', async () => {
    // A Next.js app/sitemap.ts serves /sitemap.xml and commits no XML at all. Requiring a static
    // file would decline every Next site, which is most of them.
    const result = await generate({
      'public/robots.txt': 'User-agent: *\n',
      'app/sitemap.ts': 'export default function sitemap() { return [] }',
    })

    expect(result?.files[0]?.content).toContain('Sitemap: https://ex.com/sitemap.xml')
  })

  it('does not append a second declaration when one is already there', async () => {
    const result = await generate({
      'public/robots.txt': 'User-agent: *\nSitemap: https://ex.com/sitemap.xml\n',
      'public/sitemap.xml': '<urlset />',
    })

    expect(result).toBeNull()
  })

  it('declines when there is no robots.txt to edit', async () => {
    // Creating one means deciding a site's crawl policy, and this fixer is about a discovery
    // hint. Same posture as the AI-crawlers fixer.
    const result = await generate({ 'public/sitemap.xml': '<urlset />' })

    expect(result).toBeNull()
  })

  it('preserves CRLF line endings rather than mixing them', async () => {
    const result = await generate({
      'public/robots.txt': 'User-agent: *\r\nAllow: /\r\n',
      'public/sitemap.xml': '<urlset />',
    })

    expect(result?.files[0]?.content).toBe(
      'User-agent: *\r\nAllow: /\r\n\r\nSitemap: https://ex.com/sitemap.xml\r\n',
    )
  })

  it('separates the declaration when the file does not end in a newline', async () => {
    const result = await generate({
      'public/robots.txt': 'User-agent: *\nAllow: /',
      'public/sitemap.xml': '<urlset />',
    })

    expect(result?.files[0]?.content).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://ex.com/sitemap.xml\n',
    )
  })

  it('refuses a finding whose affected URL is not a URL', async () => {
    expect(fixer.canFix(noSitemapDeclared({ affectedUrls: ['not a url'] }))).toBe(false)
  })

  it('only claims TECH-003', async () => {
    expect(fixer.canFix(noSitemapDeclared({ ruleId: 'TECH-004' }))).toBe(false)
  })

  it('states the rollback changes no crawl rule', async () => {
    const result = await generate({
      'public/robots.txt': 'User-agent: *\n',
      'public/sitemap.xml': '<urlset />',
    })

    expect(result?.rollback).toContain('no crawl rule changes')
  })
})
