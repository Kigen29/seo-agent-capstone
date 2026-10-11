import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import {
  liveCheckDue,
  mergeSettled,
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

    const verdicts = reconcileFixVerifications(mergedFindings, current, {
      successfulUrls: ['https://ex.com/about', 'https://ex.com/'],
      evaluatedRuleIds: ['TECH-007', 'TECH-002'],
      deploymentConfirmed: true,
    })

    expect(verdicts.get('gone')).toBe('verified')
    expect(verdicts.get('remains')).toBe('rejected')
    expect(verdicts.size).toBe(2)
  })

  it('verifies everything when a clean re-audit finds nothing', () => {
    const mergedFindings = [merged('a', 'TECH-007', ['https://ex.com/about'])]
    const verdicts = reconcileFixVerifications(mergedFindings, [], {
      successfulUrls: ['https://ex.com/about'],
      evaluatedRuleIds: ['TECH-007'],
      deploymentConfirmed: true,
    })
    expect(verdicts.get('a')).toBe('verified')
  })
})

it('never verifies absence from a page that was not read, with or without a deployment report', () => {
  const refs = [merged('a', 'TECH-007', ['https://ex.com/unvisited'])]
  expect(reconcileFixVerifications(refs, []).get('a')).toBe('inconclusive')
  for (const deploymentConfirmed of [true, false]) {
    expect(
      reconcileFixVerifications(refs, [], {
        successfulUrls: [],
        evaluatedRuleIds: ['TECH-007'],
        deploymentConfirmed,
      }).get('a'),
    ).toBe('inconclusive')
    // The page was read, but the rule that would have found the problem did not run.
    expect(
      reconcileFixVerifications(refs, [], {
        successfulUrls: ['https://ex.com/unvisited'],
        evaluatedRuleIds: [],
        deploymentConfirmed,
      }).get('a'),
    ).toBe('inconclusive')
  }
})

describe('without a deployment report (ADR-0047)', () => {
  const url = 'https://ex.com/about'
  const refs = [merged('a', 'TECH-007', [url])]
  const coverage = { successfulUrls: [url], evaluatedRuleIds: ['TECH-007'] }
  const stillThere = [finding('TECH-007', [url])]

  it('verifies a fix the live site shows, because the page is the evidence it was deployed', () => {
    expect(
      reconcileFixVerifications(refs, [], { ...coverage, deploymentConfirmed: false }).get('a'),
    ).toBe('verified')
  })

  it('does not call a problem still on the site a failure while the deployment may not have happened', () => {
    expect(
      reconcileFixVerifications(refs, stillThere, { ...coverage, deploymentConfirmed: false }).get(
        'a',
      ),
    ).toBe('inconclusive')
    expect(
      reconcileFixVerifications(refs, stillThere, {
        ...coverage,
        deploymentConfirmed: false,
        mergeSettled: false,
      }).get('a'),
    ).toBe('inconclusive')
  })

  it('calls it a failure once the merge has settled', () => {
    expect(
      reconcileFixVerifications(refs, stillThere, {
        ...coverage,
        deploymentConfirmed: false,
        mergeSettled: true,
      }).get('a'),
    ).toBe('rejected')
  })

  it('treats a rule-specific check the same way', () => {
    const base = { ...coverage, deploymentConfirmed: false }
    expect(
      reconcileFixVerifications(refs, [], { ...base, checks: { a: 'verified' } }).get('a'),
    ).toBe('verified')
    expect(
      reconcileFixVerifications(refs, [], { ...base, checks: { a: 'rejected' } }).get('a'),
    ).toBe('inconclusive')
    expect(
      reconcileFixVerifications(refs, [], {
        ...base,
        mergeSettled: true,
        checks: { a: 'rejected' },
      }).get('a'),
    ).toBe('rejected')
    // Settled or not, a check that could not conclude concludes nothing.
    expect(
      reconcileFixVerifications(refs, [], {
        ...base,
        mergeSettled: true,
        checks: { a: 'inconclusive' },
      }).get('a'),
    ).toBe('inconclusive')
    expect(
      reconcileFixVerifications(refs, [], { ...base, mergeSettled: true, checks: {} }).get('a'),
    ).toBe('inconclusive')
  })

  it('needs no settling when a deployment was reported: what the site shows is the verdict', () => {
    expect(
      reconcileFixVerifications(refs, stillThere, { ...coverage, deploymentConfirmed: true }).get(
        'a',
      ),
    ).toBe('rejected')
  })
})

describe('mergeSettled', () => {
  const merge = new Date('2026-10-01T10:00:00Z')
  it('is 48 hours after the merge, and never without a merge time', () => {
    expect(mergeSettled(merge, new Date('2026-10-03T09:59:00Z'))).toBe(false)
    expect(mergeSettled(merge, new Date('2026-10-03T10:00:00Z'))).toBe(true)
    // An unknown merge time must not turn into an automatic failure.
    expect(mergeSettled(null, new Date('2030-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('liveCheckDue', () => {
  const merge = new Date('2026-10-01T10:00:00Z')
  const at = (hours: number) => new Date(merge.getTime() + hours * 3_600_000)

  it('looks at once when the site has never been looked at', () => {
    expect(liveCheckDue(merge, null, at(0.1))).toBe(true)
    expect(liveCheckDue(null, null, at(500))).toBe(true)
  })

  it('looks at one, three, six, twelve and twenty-four hours, and not in between', () => {
    expect(liveCheckDue(merge, at(0.2), at(0.9))).toBe(false)
    expect(liveCheckDue(merge, at(0.2), at(1.1))).toBe(true)
    expect(liveCheckDue(merge, at(1.1), at(2.5))).toBe(false)
    expect(liveCheckDue(merge, at(2.5), at(3.2))).toBe(true)
    expect(liveCheckDue(merge, at(3.2), at(5.9))).toBe(false)
    expect(liveCheckDue(merge, at(5.9), at(6.5))).toBe(true)
    expect(liveCheckDue(merge, at(6.5), at(11))).toBe(false)
    expect(liveCheckDue(merge, at(11), at(12.5))).toBe(true)
    expect(liveCheckDue(merge, at(12.5), at(23))).toBe(false)
    expect(liveCheckDue(merge, at(23), at(24.5))).toBe(true)
  })

  it('does not lose a checkpoint the worker slept through', () => {
    // The worker did not run between hour 2 and hour 9: three and six both passed. One look.
    expect(liveCheckDue(merge, at(2), at(9))).toBe(true)
  })

  it('looks once a day after the first, for as long as nothing can be concluded', () => {
    expect(liveCheckDue(merge, at(24.5), at(47))).toBe(false)
    expect(liveCheckDue(merge, at(47), at(48.2))).toBe(true)
    expect(liveCheckDue(merge, at(48.2), at(71))).toBe(false)
    expect(liveCheckDue(merge, at(71), at(72.5))).toBe(true)
    expect(liveCheckDue(merge, at(240.5), at(263.9))).toBe(false)
    expect(liveCheckDue(merge, at(240.5), at(264.1))).toBe(true)
  })

  it('is once a day when nobody recorded when the merge happened', () => {
    expect(liveCheckDue(null, at(10), at(33))).toBe(false)
    expect(liveCheckDue(null, at(10), at(34))).toBe(true)
  })
})
