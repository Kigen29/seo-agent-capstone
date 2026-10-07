import { describe, expect, it } from 'vitest'
import { diffFindings } from '../src/history.js'

/**
 * Comparing two audits. The whole of "did the fix work" rests on this being exact: an issue is
 * resolved when the earlier audit raised it and the later one did not, by identity and not by
 * position or by count.
 */
const row = (
  id: string,
  fingerprint: string | null,
  over: Partial<Parameters<typeof diffFindings>[0][number]> = {},
) => ({
  id,
  auditId: 'a',
  ruleId: 'TECH-026',
  title: `Finding ${id}`,
  severity: 'medium' as const,
  axis: 'content' as const,
  status: 'open',
  prUrl: null,
  fingerprint,
  ...over,
})

describe('diffFindings', () => {
  it('reports what went, what came, and what stayed', () => {
    const diff = diffFindings([row('1', 'x'), row('2', 'y')], [row('3', 'y'), row('4', 'z')])

    expect(diff.resolved.map((f) => f.rowId)).toEqual(['1'])
    expect(diff.added.map((f) => f.rowId)).toEqual(['4'])
    expect(diff.carried).toBe(1)
  })

  it('is not fooled by the same number of findings', () => {
    const diff = diffFindings([row('1', 'x')], [row('2', 'y')])

    expect(diff.resolved).toHaveLength(1)
    expect(diff.added).toHaveLength(1)
    expect(diff.carried).toBe(0)
  })

  it('keeps the pull request of a resolved finding, so the fix can be named', () => {
    const diff = diffFindings(
      [row('1', 'x', { status: 'merged', prUrl: 'https://github.com/o/r/pull/2' })],
      [],
    )

    expect(diff.resolved[0]).toMatchObject({
      status: 'merged',
      prUrl: 'https://github.com/o/r/pull/2',
    })
  })

  it('matches findings older than fingerprints by rule and title', () => {
    const before = [row('1', null, { title: 'Missing description on /about' })]
    const after = [row('2', null, { title: 'Missing description on /about' })]

    expect(diffFindings(before, after)).toMatchObject({ resolved: [], added: [], carried: 1 })
  })

  it('lists the most severe first', () => {
    const diff = diffFindings(
      [],
      [
        row('1', 'a', { severity: 'low' }),
        row('2', 'b', { severity: 'critical' }),
        row('3', 'c', { severity: 'high' }),
      ],
    )

    expect(diff.added.map((f) => f.severity)).toEqual(['critical', 'high', 'low'])
  })
})
