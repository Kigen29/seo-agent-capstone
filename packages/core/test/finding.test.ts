import { describe, expect, it } from 'vitest'
import { findingSchema, parseFinding, type Finding } from '../src/finding.js'
import { aFinding, anEvidence } from './fixtures.js'

describe('the falsification rule', () => {
  it('rejects a finding at compile time when falsification is missing', () => {
    // @ts-expect-error falsification is required. If this ever compiles, rule 3 has a
    // hole in it and TypeScript will fail this file for an unused @ts-expect-error.
    const bad: Finding = {
      id: 'f_1',
      siteId: 's_1',
      ruleId: 'TECH-010',
      axis: 'crawl_health',
      severity: 'high',
      confidence: 1,
      title: 'Broken internal link',
      evidence: { ...anEvidence },
      affectedUrls: ['https://example.com/pricing'],
      estimatedEffort: 'trivial',
      estimatedImpact: 40,
      fixable: true,
      status: 'open',
    }

    expect(bad).toBeDefined()
  })

  it('rejects an empty falsification at runtime, which the type system cannot catch', () => {
    const result = findingSchema.safeParse(aFinding({ falsification: '' }))

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['falsification'])
  })

  it('accepts a finding that says how it could be proved wrong', () => {
    expect(() => parseFinding(aFinding())).not.toThrow()
  })
})

describe('findingSchema', () => {
  it('defaults status to open, so a fresh finding is never in limbo', () => {
    const { status: _dropped, ...withoutStatus } = aFinding()

    expect(parseFinding(withoutStatus).status).toBe('open')
  })

  it.each([
    ['confidence above 1', { confidence: 1.5 }],
    ['confidence below 0', { confidence: -0.1 }],
    ['impact above 100', { estimatedImpact: 101 }],
  ])('rejects %s', (_name, override) => {
    expect(findingSchema.safeParse(aFinding(override as Partial<Finding>)).success).toBe(false)
  })

  it('rejects evidence that is not one of the known kinds, so no rule can record prose', () => {
    const result = findingSchema.safeParse(
      aFinding({ evidence: { kind: 'vibes', note: 'feels slow' } as never }),
    )

    expect(result.success).toBe(false)
  })

  it('keeps the evidence discriminated, so a fixer can branch on what was observed', () => {
    const finding = parseFinding(aFinding())

    // The narrowing below is the point: without the discriminant this would not compile.
    if (finding.evidence.kind === 'http') {
      expect(finding.evidence.status).toBe(404)
    } else {
      throw new Error('expected http evidence')
    }
  })
})
