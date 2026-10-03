import { metricSnapshotSchema, verificationResultSchema, type Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import {
  baselineFor,
  failingPagesMetric,
  stillFailingCount,
  verificationFor,
} from '../src/outcome-evidence.js'

const now = new Date('2026-09-26T12:00:00.000Z')
const merged = {
  id: 'row-1',
  ruleId: 'TECH-022',
  affectedUrls: ['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c'],
}
const current = (urls: string[], ruleId = 'TECH-022') =>
  [{ ruleId, affectedUrls: urls }] as unknown as Finding[]

describe('outcome evidence', () => {
  it('records a baseline of every flagged page failing, in the snapshot schema', () => {
    const baseline = baselineFor(merged, now)
    expect(metricSnapshotSchema.parse(baseline)).toEqual(baseline)
    expect(baseline.metrics[0]).toMatchObject({
      metric: failingPagesMetric('TECH-022'),
      value: 3,
      unit: 'count',
    })
  })

  it('counts only flagged pages that still fail the same rule', () => {
    expect(stillFailingCount(merged, current(['https://ex.com/b', 'https://ex.com/other']))).toBe(1)
    expect(stillFailingCount(merged, current(['https://ex.com/a'], 'TECH-010'))).toBe(0)
  })

  it('records a verified fix as zero failing pages, keeping the recorded baseline', () => {
    const baseline = baselineFor(merged, new Date('2026-09-20T00:00:00.000Z'))
    const record = verificationFor({ ...merged, baseline }, 'verified', [], now)
    expect(verificationResultSchema.parse(record)).toEqual(record)
    expect(record.before).toBe(baseline)
    expect(record.after.metrics[0]!.value).toBe(0)
    expect(record.summary).toBe(
      'After the fix was deployed, TECH-022 no longer fires on any of the 3 pages it flagged.',
    )
  })

  it('records a rejected fix with how many pages still fail, and says the fix did not work', () => {
    const record = verificationFor(
      merged,
      'rejected',
      current(['https://ex.com/a', 'https://ex.com/c']),
      now,
    )
    expect(record.after.metrics[0]!.value).toBe(2)
    expect(record.before.metrics).toEqual([]) // A missing historical baseline is not a new observation.
    expect(record.summary).toContain('still fires on 2 of the 3 pages')
    expect(record.summary).toContain('did not work')
    expect(record.summary).not.toMatch(/—/)
  })
})
