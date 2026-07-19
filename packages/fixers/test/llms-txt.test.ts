import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { LlmsTxtFixer } from '../src/fixers/llms-txt.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** An AGENT-001 finding carrying the site's key pages, as the rule records them. */
function llmsFinding(overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'AGENT-001',
    axis: 'agent_readiness',
    severity: 'low',
    title: 'https://ex.com/ has no llms.txt',
    affectedUrls: ['https://ex.com/', 'https://ex.com/about', 'https://ex.com/pricing'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: '/llms.txt',
      snippet: '',
      observedAt: '2026-07-19T00:00:00.000Z',
      source: 'crawler',
    },
    falsification: 'A re-fetch of /llms.txt still returns nothing. Google Search ignores it.',
    ...overrides,
  })
}

const fixer = new LlmsTxtFixer()

describe('LlmsTxtFixer', () => {
  it('writes a well-formed llms.txt beside an existing robots.txt', async () => {
    const result = await fixer.generate({
      finding: llmsFinding(),
      framework: 'react_spa',
      read: reader({ 'public/robots.txt': 'User-agent: *\nAllow: /' }),
    })

    expect(result).not.toBeNull()
    expect(result!.files).toHaveLength(1)
    const file = result!.files[0]!
    // Co-located with robots.txt.
    expect(file.path).toBe('public/llms.txt')
    // A heading, the honest description, and the key pages as links.
    expect(file.content).toMatch(/^# /)
    expect(file.content).toContain('Google Search ignores it')
    expect(file.content).toContain('](https://ex.com/about)')
    expect(file.content).toContain('](https://ex.com/pricing)')
    expect(result!.expectedEffect).toContain('public/llms.txt')
  })

  it('titles the file from the head when there is one', async () => {
    const result = await fixer.generate({
      finding: llmsFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': '<html><head><title>Ex Safaris</title></head></html>' }),
    })
    expect(result!.files[0]!.content).toContain('# Ex Safaris')
  })

  it('falls back to the framework static dir when there is no robots.txt', async () => {
    const spa = await fixer.generate({
      finding: llmsFinding(),
      framework: 'react_spa',
      read: reader({}),
    })
    expect(spa!.files[0]!.path).toBe('public/llms.txt')

    const universal = await fixer.generate({
      finding: llmsFinding(),
      framework: 'unknown',
      read: reader({}),
    })
    expect(universal!.files[0]!.path).toBe('llms.txt')
  })

  it('does not overwrite an llms.txt that already exists', async () => {
    const result = await fixer.generate({
      finding: llmsFinding(),
      framework: 'react_spa',
      read: reader({ 'public/robots.txt': 'User-agent: *', 'public/llms.txt': '# already here' }),
    })
    expect(result).toBeNull()
  })

  it('ignores findings from other rules', () => {
    expect(fixer.canFix(makeFinding({ ruleId: 'TECH-007' }))).toBe(false)
  })
})
