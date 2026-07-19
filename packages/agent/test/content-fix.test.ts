import type { Finding } from '@seo/core'
import type { ReadRepoFile } from '@seo/fixers'
import { describe, expect, it, vi } from 'vitest'
import { generateContentFix, type ContentLlm } from '../src/content-fix.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** A TECH-021 finding: the homepage has no meta description. */
function descriptionFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'TECH-021#0',
    siteId: 'site-1',
    ruleId: 'TECH-021',
    axis: 'content',
    severity: 'low',
    confidence: 1,
    title: 'https://ex.com/ has no meta description',
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'meta[name="description"]',
      snippet: '',
      observedAt: '2026-07-19T00:00:00.000Z',
      source: 'crawler',
    },
    affectedUrls: ['https://ex.com/'],
    estimatedEffort: 'trivial',
    estimatedImpact: 30,
    falsification: 'A re-crawl still finds no meta description on the homepage.',
    fixable: true,
    status: 'open',
    ...overrides,
  }
}

const INDEX_HTML =
  '<!doctype html>\n<html>\n  <head>\n    <title>Ex Safaris</title>\n  </head>\n  <body></body>\n</html>\n'
const DESCRIPTION =
  'Ex Safaris runs small-group wildlife safaris across Kenya, from the Mara to Amboseli.'

/** A fake LLM that returns a fixed description and records how it was called. */
function fakeLlm(description = DESCRIPTION): ContentLlm & { calls: number } {
  return {
    calls: 0,
    async object(opts) {
      this.calls += 1
      // The real client validates against the schema; here we prove the caller passed one and a
      // smart role, then hand back a value the schema accepts.
      expect(opts.role).toBe('smart')
      return { output: opts.schema.parse({ description }) }
    },
  }
}

describe('generateContentFix', () => {
  it('writes one description via a single smart call and injects it into the head', async () => {
    const llm = fakeLlm()
    const result = await generateContentFix(
      {
        finding: descriptionFinding(),
        framework: 'react_spa',
        read: reader({ 'index.html': INDEX_HTML }),
        siteUrl: 'https://ex.com',
      },
      { llm, tenantId: 'tenant-1' },
    )

    expect(llm.calls).toBe(1) // exactly one call per finding (ADR-0005 cost discipline)
    expect(result).not.toBeNull()
    expect(result!.files).toHaveLength(1)
    expect(result!.files[0]!.path).toBe('index.html')
    expect(result!.files[0]!.content).toContain(`<meta name="description" content="${DESCRIPTION}"`)
    expect(result!.expectedEffect).toContain(DESCRIPTION)
    expect(result!.rollback).toMatch(/revert/i)
  })

  it('grounds the prompt on the page title read from the head', async () => {
    const llm = fakeLlm()
    const spy = vi.spyOn(llm, 'object')
    await generateContentFix(
      {
        finding: descriptionFinding(),
        framework: 'react_spa',
        read: reader({ 'index.html': INDEX_HTML }),
        siteUrl: 'https://ex.com',
      },
      { llm, tenantId: 'tenant-1' },
    )
    expect(spy.mock.calls[0]![0].prompt).toContain('Ex Safaris')
  })

  it('leaves the finding open when the LLM chain is unavailable', async () => {
    // Every target failed, or no provider is configured: the client throws. No broken PR.
    const failing: ContentLlm = {
      async object() {
        throw new Error('AllTargetsFailedError: no provider configured for role smart')
      },
    }
    const result = await generateContentFix(
      {
        finding: descriptionFinding(),
        framework: 'react_spa',
        read: reader({ 'index.html': INDEX_HTML }),
        siteUrl: 'https://ex.com',
      },
      { llm: failing, tenantId: 'tenant-1' },
    )
    expect(result).toBeNull()
  })

  it('returns null without calling the LLM for a rule it does not handle', async () => {
    const llm = fakeLlm()
    const result = await generateContentFix(
      {
        finding: descriptionFinding({ ruleId: 'TECH-007' }),
        framework: 'react_spa',
        read: reader({ 'index.html': INDEX_HTML }),
        siteUrl: 'https://ex.com',
      },
      { llm, tenantId: 'tenant-1' },
    )
    expect(result).toBeNull()
    expect(llm.calls).toBe(0)
  })

  it('returns null when there is no head to inject into', async () => {
    const llm = fakeLlm()
    const result = await generateContentFix(
      {
        finding: descriptionFinding(),
        framework: 'react_spa',
        read: reader({ 'index.html': '<html><body></body></html>' }),
        siteUrl: 'https://ex.com',
      },
      { llm, tenantId: 'tenant-1' },
    )
    expect(result).toBeNull()
  })
})
