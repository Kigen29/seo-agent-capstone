import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import {
  reconcileFixVerifications,
  stillPresent,
  type MergedFindingRef,
} from '../src/verify-fixes.js'

/** A current-audit finding, filled out enough to be a Finding; only ruleId and URLs matter here. */
function finding(ruleId: string, affectedUrls: string[]): Finding {
  return {
    id: `${ruleId}#0`,
    siteId: 'site-1',
    ruleId,
    axis: 'crawl_health',
    severity: 'high',
    confidence: 1,
    title: `${ruleId} on ${affectedUrls[0] ?? '?'}`,
    evidence: {
      kind: 'http',
      url: affectedUrls[0] ?? 'https://example.com/',
      status: 200,
      redirectChain: [],
      observedAt: '2026-07-19T00:00:00.000Z',
      source: 'crawler',
    },
    affectedUrls,
    estimatedEffort: 'trivial',
    estimatedImpact: 70,
    falsification: 'a re-crawl no longer reproduces it',
    fixable: true,
    status: 'open',
  }
}

const merged = (id: string, ruleId: string, affectedUrls: string[]): MergedFindingRef => ({
  id,
  ruleId,
  affectedUrls,
})

describe('stillPresent', () => {
  it('is true when the same rule fires on an overlapping URL', () => {
    const ref = merged('row-1', 'TECH-007', ['https://ex.com/about', 'https://ex.com/'])
    const current = [finding('TECH-007', ['https://ex.com/about', 'https://www.ex.com/'])]
    expect(stillPresent(ref, current)).toBe(true)
  })

  it('is false when the fix removed the finding', () => {
    const ref = merged('row-1', 'TECH-007', ['https://ex.com/about', 'https://ex.com/'])
    // The re-audit found other things, but nothing TECH-007 on that page.
    const current = [
      finding('TECH-006', ['https://ex.com/about']),
      finding('TECH-007', ['https://ex.com/pricing']),
    ]
    expect(stillPresent(ref, current)).toBe(false)
  })

  it('does not match the same rule on a different page', () => {
    const ref = merged('row-1', 'TECH-007', ['https://ex.com/about'])
    const current = [finding('TECH-007', ['https://ex.com/contact'])]
    expect(stillPresent(ref, current)).toBe(false)
  })

  it('does not match a different rule on the same page', () => {
    const ref = merged('row-1', 'TECH-007', ['https://ex.com/about'])
    const current = [finding('TECH-006', ['https://ex.com/about'])]
    expect(stillPresent(ref, current)).toBe(false)
  })
})

describe('reconcileFixVerifications', () => {
  it('verifies what is gone and rejects what remains, keyed by row id', () => {
    const mergedFindings = [
      merged('gone', 'TECH-007', ['https://ex.com/about', 'https://ex.com/']),
      merged('remains', 'TECH-002', ['https://ex.com/']),
    ]
    const current = [finding('TECH-002', ['https://ex.com/'])]

    const verdicts = reconcileFixVerifications(mergedFindings, current)

    expect(verdicts.get('gone')).toBe('verified')
    expect(verdicts.get('remains')).toBe('rejected')
    expect(verdicts.size).toBe(2)
  })

  it('verifies everything when a clean re-audit finds nothing', () => {
    const mergedFindings = [merged('a', 'TECH-007', ['https://ex.com/about'])]
    const verdicts = reconcileFixVerifications(mergedFindings, [])
    expect(verdicts.get('a')).toBe('verified')
  })
})
