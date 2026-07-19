import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { LocalBusinessFixer } from '../src/fixers/local-business.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

const CONTACT = {
  name: 'Acme Cafe',
  address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Nairobi' },
  telephone: '+254700000000',
}

/** A LOCAL-001 finding whose evidence carries the contact data the rule found. */
function localFinding(
  snippet = JSON.stringify(CONTACT),
  overrides: Partial<Finding> = {},
): Finding {
  return makeFinding({
    ruleId: 'LOCAL-001',
    axis: 'local',
    severity: 'medium',
    title: 'https://ex.com/ has contact details but no LocalBusiness structured data',
    affectedUrls: ['https://ex.com/'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'script[type="application/ld+json"]',
      snippet,
      observedAt: '2026-07-19T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })
}

const HEAD =
  '<!doctype html>\n<html>\n  <head>\n    <title>Ex</title>\n  </head>\n  <body></body>\n</html>\n'
const fixer = new LocalBusinessFixer()

describe('LocalBusinessFixer', () => {
  it('injects a LocalBusiness JSON-LD block built from the carried contact data', async () => {
    const result = await fixer.generate({
      finding: localFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': HEAD }),
    })

    expect(result).not.toBeNull()
    const content = result!.files[0]!.content
    expect(content).toContain('application/ld+json')
    expect(content).toContain('"@type": "LocalBusiness"')
    expect(content).toContain('Acme Cafe')
    expect(content).toContain('+254700000000')
    expect(content).toContain('1 Main St')
    // The head is otherwise intact.
    expect(content).toContain('<title>Ex</title>')
  })

  it('falls back to the head title for the name when the contact carried none', async () => {
    const result = await fixer.generate({
      finding: localFinding(JSON.stringify({ telephone: '+254700000000' })),
      framework: 'react_spa',
      read: reader({ 'index.html': HEAD }),
    })
    expect(result!.files[0]!.content).toContain('"name": "Ex"')
  })

  it('declines when the evidence carries no address or phone to build from', async () => {
    const finding = localFinding(JSON.stringify({ name: 'Just a name' }))
    expect(fixer.canFix(finding)).toBe(false)
    expect(
      await fixer.generate({
        finding,
        framework: 'react_spa',
        read: reader({ 'index.html': HEAD }),
      }),
    ).toBeNull()
  })

  it('returns null when there is no head to inject into', async () => {
    const result = await fixer.generate({
      finding: localFinding(),
      framework: 'react_spa',
      read: reader({ 'index.html': '<html><body></body></html>' }),
    })
    expect(result).toBeNull()
  })

  it('ignores findings from other rules', () => {
    expect(fixer.canFix(makeFinding({ ruleId: 'AGENT-001' }))).toBe(false)
  })
})
