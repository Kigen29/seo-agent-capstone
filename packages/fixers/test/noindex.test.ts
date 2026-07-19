import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { RemoveNoindexFixer } from '../src/fixers/noindex.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** A TECH-005 finding whose noindex is a robots meta tag (the fixable, head case). */
function noindexFinding(overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'TECH-005',
    title: 'https://ex.com/ is noindexed but is in the sitemap',
    affectedUrls: ['https://ex.com/'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'meta[name="robots"]',
      snippet: '<meta name="robots" content="noindex" />',
      observedAt: '2026-07-19T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

const fixer = new RemoveNoindexFixer()
const head = (meta: string) =>
  `<!doctype html>\n<html>\n  <head>\n    <title>t</title>\n    ${meta}\n  </head>\n  <body></body>\n</html>\n`

describe('RemoveNoindexFixer', () => {
  it('removes a bare noindex robots meta from the head', async () => {
    const result = await fixer.generate({
      finding: noindexFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': head('<meta name="robots" content="noindex" />') }),
    })

    expect(result).not.toBeNull()
    expect(result!.files[0]!.path).toBe('index.html')
    expect(result!.files[0]!.content.toLowerCase()).not.toContain('noindex')
    // The rest of the head is intact.
    expect(result!.files[0]!.content).toContain('<title>t</title>')
    expect(result!.rollback).toMatch(/revert/i)
  })

  it('keeps other directives, dropping only the indexing block', async () => {
    const result = await fixer.generate({
      finding: noindexFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': head('<meta name="robots" content="noindex, follow" />') }),
    })

    expect(result).not.toBeNull()
    const content = result!.files[0]!.content
    expect(content).toContain('content="follow"')
    expect(content.toLowerCase()).not.toContain('noindex')
  })

  it('declines a noindex delivered by an X-Robots-Tag header', async () => {
    // The block is in a response header, not the repo's HTML, so there is nothing safe to edit.
    const finding = noindexFinding({
      evidence: {
        kind: 'http',
        url: 'https://ex.com/',
        status: 200,
        redirectChain: [],
        headers: { 'x-robots-tag': 'noindex' },
        observedAt: '2026-07-19T00:00:00.000Z',
        source: 'crawler',
      },
    })
    expect(fixer.canFix(finding)).toBe(false)
    expect(
      await fixer.generate({
        finding,
        framework: 'react_spa',
        read: reader({ 'index.html': head('<meta name="robots" content="noindex" />') }),
      }),
    ).toBeNull()
  })

  it('returns null when the head has no robots meta to remove (clean fixture)', async () => {
    const result = await fixer.generate({
      finding: noindexFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': head('<meta name="description" content="a site" />') }),
    })
    expect(result).toBeNull()
  })

  it('ignores findings from other rules', () => {
    expect(fixer.canFix(makeFinding({ ruleId: 'TECH-007' }))).toBe(false)
  })
})
