import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { MixedContentFixer } from '../src/fixers/mixed-content.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** A TECH-015 finding, as the rule records it: one `<type>: <url>` line per insecure resource. */
function mixedContent(resources: string[], overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'TECH-015',
    title: 'https://ex.com/ loads resources over insecure HTTP',
    affectedUrls: ['https://ex.com/'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'script[src^="http://"], link[href^="http://"]',
      snippet: resources.join('\n'),
      observedAt: '2026-08-23T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

const fixer = new MixedContentFixer()
const generate = (files: Record<string, string>, finding: Finding) =>
  fixer.generate({ finding, framework: 'next', read: reader(files) })

describe('MixedContentFixer', () => {
  it('upgrades the exact URLs the finding recorded', async () => {
    const result = await generate(
      {
        'app/layout.tsx':
          '<script src="http://cdn.ex.com/a.js" />\n<link href="http://cdn.ex.com/s.css" />',
      },
      mixedContent(['script: http://cdn.ex.com/a.js', 'stylesheet: http://cdn.ex.com/s.css']),
    )

    expect(result?.files[0]?.content).toBe(
      '<script src="https://cdn.ex.com/a.js" />\n<link href="https://cdn.ex.com/s.css" />',
    )
  })

  it('leaves an http:// URL that is not a subresource alone', async () => {
    // The reason this replaces exact URLs instead of running http:// -> https:// over the file.
    // schema.org's @context is correct as http, a link in prose is not ours to rewrite, and
    // neither is a subresource.
    const layout = [
      '<script src="http://cdn.ex.com/a.js" />',
      '<script type="application/ld+json">{"@context":"http://schema.org"}</script>',
      '<!-- see http://example.org/spec for why -->',
    ].join('\n')

    const result = await generate(
      { 'app/layout.tsx': layout },
      mixedContent(['script: http://cdn.ex.com/a.js']),
    )

    expect(result?.files[0]?.content).toContain('"@context":"http://schema.org"')
    expect(result?.files[0]?.content).toContain('http://example.org/spec')
    expect(result?.files[0]?.content).toContain('https://cdn.ex.com/a.js')
  })

  it('upgrades every occurrence of the same URL', async () => {
    const result = await generate(
      { 'app/layout.tsx': 'http://cdn.ex.com/a.js and again http://cdn.ex.com/a.js' },
      mixedContent(['script: http://cdn.ex.com/a.js']),
    )

    expect(result?.files[0]?.content).toBe(
      'https://cdn.ex.com/a.js and again https://cdn.ex.com/a.js',
    )
  })

  it('does not leave a longer URL half-upgraded by rewriting a prefix of it first', async () => {
    // http://cdn.ex.com/a.js is a prefix of http://cdn.ex.com/a.js.map. Shortest-first would
    // produce https://cdn.ex.com/a.js.map only by accident, and corrupt it in other orderings.
    const result = await generate(
      { 'app/layout.tsx': '<script src="http://cdn.ex.com/a.js.map" />' },
      mixedContent(['script: http://cdn.ex.com/a.js', 'script: http://cdn.ex.com/a.js.map']),
    )

    expect(result?.files[0]?.content).toBe('<script src="https://cdn.ex.com/a.js.map" />')
  })

  it('declines when the resource is hardcoded somewhere it cannot reach', async () => {
    // A URL in a component three directories down is real and common. The reader fetches known
    // paths and cannot search, so the honest answer is that a human places this one.
    const result = await generate(
      { 'app/layout.tsx': '<html><head></head></html>' },
      mixedContent(['img: http://cdn.ex.com/hero.png']),
    )

    expect(result).toBeNull()
  })

  it('says which resources it could not reach, so the PR is not read as complete', async () => {
    const result = await generate(
      { 'app/layout.tsx': '<script src="http://cdn.ex.com/a.js" />' },
      mixedContent(['script: http://cdn.ex.com/a.js', 'img: http://cdn.ex.com/hero.png']),
    )

    expect(result?.expectedEffect).toContain('http://cdn.ex.com/hero.png')
    expect(result?.expectedEffect).toContain('keep firing')
  })

  it('warns that a host may not serve the asset over TLS', async () => {
    // The judgement this fixer cannot make, handed to the reviewer rather than hidden. An image
    // loading today over http can 404 over https.
    const result = await generate(
      { 'app/layout.tsx': '<img src="http://cdn.ex.com/hero.png" />' },
      mixedContent(['img: http://cdn.ex.com/hero.png']),
    )

    expect(result?.expectedEffect).toContain('serves the asset over TLS')
  })

  it('refuses a finding with no insecure URLs in its evidence', async () => {
    expect(fixer.canFix(mixedContent([]))).toBe(false)
    expect(fixer.canFix(mixedContent(['script: https://cdn.ex.com/a.js']))).toBe(false)
  })

  it('only claims TECH-015', async () => {
    expect(fixer.canFix(mixedContent(['script: http://a.ex/x.js'], { ruleId: 'TECH-019' }))).toBe(
      false,
    )
  })
})
