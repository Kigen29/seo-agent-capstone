import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { CanonicalRedirectFixer } from '../src/fixers/canonical.js'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { makeFinding } from './fixtures.js'

/** A repo reader backed by an in-memory map of path -> contents. */
function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/**
 * A TECH-007 finding in its fixable shape: the declared canonical (the apex) redirects to the
 * www origin, which serves a 200. The http evidence records the final URL and the redirect hop,
 * exactly as the crawler and rule produce it.
 */
function redirectFinding(overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'TECH-007',
    title: 'https://heartbeestsafaris.com/about declares a canonical that redirects',
    affectedUrls: ['https://heartbeestsafaris.com/about', 'https://heartbeestsafaris.com/'],
    evidence: {
      kind: 'http',
      url: 'https://www.heartbeestsafaris.com/',
      status: 200,
      redirectChain: ['https://heartbeestsafaris.com/'],
      observedAt: '2026-07-17T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

const fixer = new CanonicalRedirectFixer()

const INDEX_HTML = [
  '<!doctype html>',
  '<html>',
  '  <head>',
  '    <link rel="canonical" href="https://heartbeestsafaris.com/about" />',
  '    <meta property="og:url" content="https://heartbeestsafaris.com/about" />',
  '  </head>',
  '  <body></body>',
  '</html>',
  '',
].join('\n')

describe('CanonicalRedirectFixer', () => {
  it('rewrites the redirecting origin to the one that serves the page', async () => {
    const result = await fixer.generate({
      finding: redirectFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': INDEX_HTML }),
    })

    expect(result).not.toBeNull()
    expect(result!.files).toHaveLength(1)
    const file = result!.files[0]!
    expect(file.path).toBe('index.html')
    expect(file.content).toContain('href="https://www.heartbeestsafaris.com/about"')
    expect(file.content).toContain('content="https://www.heartbeestsafaris.com/about"')
    // The redirecting apex origin is gone entirely.
    expect(file.content).not.toContain('href="https://heartbeestsafaris.com/about"')
    // And the PR body fields rule 4 requires are populated.
    expect(result!.expectedEffect).toMatch(/www\.heartbeestsafaris\.com/)
    expect(result!.rollback).toMatch(/revert/i)
  })

  it('declines a canonical that 404s rather than redirects', async () => {
    // A target that returns 404 with no redirect is a different problem: the page does not exist,
    // and rewriting the host cannot conjure it. A human decides what the canonical should be.
    const finding = redirectFinding({
      evidence: {
        kind: 'http',
        url: 'https://heartbeestsafaris.com/gone',
        status: 404,
        redirectChain: [],
        observedAt: '2026-07-17T00:00:00.000Z',
        source: 'crawler',
      },
    })
    expect(fixer.canFix(finding)).toBe(false)
    expect(
      await fixer.generate({
        finding,
        framework: 'react_spa',
        read: reader({ 'index.html': INDEX_HTML }),
      }),
    ).toBeNull()
  })

  it('returns null when the origin is not in a head file it can read', async () => {
    // The canonical is generated somewhere the reader cannot reach (a component, a config the
    // strategy does not list). Honest null, not a guess, so the worker reports it instead of
    // opening a PR that changes nothing.
    const result = await fixer.generate({
      finding: redirectFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': '<!doctype html><html><head></head><body></body></html>' }),
    })
    expect(result).toBeNull()
  })

  it('does not rewrite a longer hostname that merely starts with the same string', async () => {
    const html = [
      '<head>',
      '  <link rel="canonical" href="https://heartbeestsafaris.com/" />',
      '  <a href="https://heartbeestsafaris.com.evil.test/">not us</a>',
      '</head>',
    ].join('\n')

    const result = await fixer.generate({
      finding: redirectFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': html }),
    })

    expect(result).not.toBeNull()
    expect(result!.files[0]!.content).toContain('href="https://www.heartbeestsafaris.com/"')
    // The look-alike host is untouched.
    expect(result!.files[0]!.content).toContain('https://heartbeestsafaris.com.evil.test/')
  })

  it('ignores findings from other rules', () => {
    expect(fixer.canFix(makeFinding({ ruleId: 'TECH-006' }))).toBe(false)
  })
})
