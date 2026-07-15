import { prioritise } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { evaluateCoreWebVitals } from '../src/crux/evaluate.js'
import { bandFor, type MetricId } from '../src/crux/thresholds.js'
import type { CruxRecord } from '../src/crux/types.js'

const record = (metrics: Array<[MetricId, number]>): CruxRecord => ({
  key: 'https://example.com',
  collectionPeriod: { firstDate: '2026-06-16', lastDate: '2026-07-13' },
  metrics: metrics.map(([metric, p75]) => ({ metric, p75, band: bandFor(metric, p75) })),
})

describe('evaluateCoreWebVitals', () => {
  it('says nothing about a site whose vitals are all good', () => {
    // "Never optimise a green metric." The most important assertion in the file: a fast site
    // must produce zero performance findings, or we send developers to speed up things that
    // are already fast.
    const findings = evaluateCoreWebVitals(
      's1',
      record([
        ['lcp', 2000],
        ['inp', 150],
        ['cls', 0.05],
      ]),
    )

    expect(findings).toEqual([])
  })

  it('flags a poor metric as high severity and a needs-improvement one as medium', () => {
    const poor = evaluateCoreWebVitals('s1', record([['lcp', 5000]]))
    const ni = evaluateCoreWebVitals('s1', record([['lcp', 3000]]))

    expect(poor[0]?.severity).toBe('high')
    expect(ni[0]?.severity).toBe('medium')
  })

  it('scores a poor metric as more impactful than the same metric merely needing work', () => {
    const poor = evaluateCoreWebVitals('s1', record([['inp', 600]]))[0]
    const ni = evaluateCoreWebVitals('s1', record([['inp', 300]]))[0]

    expect(poor!.estimatedImpact).toBeGreaterThan(ni!.estimatedImpact)
  })

  it('lets the ROI formula lead with the cheap poor metric, not the highest-impact one', () => {
    // This test caught a genuine tension, and the resolution is worth recording rather than
    // hiding.
    //
    // CLAUDE.md gives a Core-Web-Vitals "fix order" (INP, then LCP, then CLS). The global
    // priority score gives a different one, because it is deliberately ROI-based: it divides
    // impact by effort so the backlog is not led by expensive work that merely sounds
    // important. Poor CLS is cheap to fix, so despite LCP carrying the higher raw impact, CLS
    // leads: 8 * 55 / 2 = 220 against 8 * 70 / 5 = 112.
    //
    // These two orderings optimise different things, and they cannot both drive one sorted
    // list. The product's stated core is the ROI formula (see prioritise.ts), so it wins, and
    // the CWV fix-order guidance lives in the finding text instead of fighting the sort. The
    // impact numbers stay honest (LCP highest), and effort stays honest (INP hardest); the
    // sort is simply what those honest numbers produce.
    const findings = prioritise(
      evaluateCoreWebVitals(
        's1',
        record([
          ['lcp', 5000],
          ['cls', 0.4],
        ]),
      ),
    )

    expect(findings[0]?.ruleId).toBe('PERF-003') // CLS: cheap, so best ROI
    expect(findings[1]?.ruleId).toBe('PERF-001') // LCP: higher impact, but costlier
  })

  it('gives INP the largest effort, because it is the hardest of the three to fix', () => {
    const inp = evaluateCoreWebVitals('s1', record([['inp', 600]]))[0]
    const cls = evaluateCoreWebVitals('s1', record([['cls', 0.4]]))[0]

    expect(inp!.estimatedEffort).toBe('large')
    expect(cls!.estimatedEffort).toBe('small')
  })

  it('records the p75 field value as evidence, at the 75th percentile', () => {
    const finding = evaluateCoreWebVitals('s1', record([['lcp', 4200]]))[0]!

    expect(finding.evidence).toMatchObject({
      kind: 'metric',
      source: 'crux',
      value: 4200,
      percentile: 75,
    })
  })

  it('warns in every falsification that CrUX lags 28 days and that Lighthouse is not this metric', () => {
    // The two ways a user is most often misled about Core Web Vitals. Every performance
    // finding has to pre-empt both, or the first thing that happens after a fix is a confused
    // user looking at an unchanged number or a green lab score and concluding we were wrong.
    const findings = evaluateCoreWebVitals(
      's1',
      record([
        ['lcp', 5000],
        ['inp', 600],
        ['cls', 0.4],
      ]),
    )

    expect(findings).toHaveLength(3)
    for (const finding of findings) {
      expect(finding.falsification).toMatch(/28 days/)
      expect(finding.falsification).toMatch(/Lighthouse/)
    }
  })

  it('notes that Lighthouse cannot measure INP at all', () => {
    // INP is the special case: Lighthouse does not just disagree, it cannot measure INP and
    // substitutes Total Blocking Time. The finding says so, because "my Lighthouse INP is
    // fine" is a sentence a user will otherwise say.
    const inp = evaluateCoreWebVitals('s1', record([['inp', 600]]))[0]!

    expect(inp.falsification).toMatch(/Total Blocking Time/)
  })

  it('does not flag a good metric even when another on the same site is poor', () => {
    const findings = evaluateCoreWebVitals(
      's1',
      record([
        ['lcp', 5000], // poor
        ['inp', 150], // good, must stay silent
        ['cls', 0.05], // good, must stay silent
      ]),
    )

    expect(findings.map((f) => f.ruleId)).toEqual(['PERF-001'])
  })
})
