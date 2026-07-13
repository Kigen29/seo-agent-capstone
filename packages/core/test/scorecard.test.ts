import { describe, expect, it } from 'vitest'
import { AXES } from '../src/axis.js'
import { buildScorecard, scorecardSchema, type ScorecardInput } from '../src/scorecard.js'
import { aFinding } from './fixtures.js'

/** Coverage claiming every axis was checked, so a test can isolate the scoring maths. */
const allMeasured = Object.fromEntries(
  AXES.map((axis) => [axis, { checksRun: 5 }]),
) as ScorecardInput['coverage']

const build = (input: Partial<ScorecardInput> = {}) =>
  buildScorecard({ siteId: 's_1', findings: [], coverage: allMeasured, ...input })

const axis = (scorecard: ReturnType<typeof build>, name: string) =>
  scorecard.axes.find((a) => a.axis === name)

describe('buildScorecard', () => {
  it('reports every axis exactly once, in a stable order', () => {
    expect(build().axes.map((a) => a.axis)).toEqual([...AXES])
  })

  it('produces a scorecard that satisfies its own schema', () => {
    expect(() => scorecardSchema.parse(build())).not.toThrow()
  })

  it('has no overall score, because averaging the axes would destroy them', () => {
    // Guards CLAUDE.md: "Never ship a single SEO score out of 100." A site can have
    // immaculate crawl health and be invisible to every AI engine on the web. Any field
    // added here that collapses the eight axes into one number is a bug, and this test
    // is what fails when someone adds it.
    expect(Object.keys(build()).sort()).toEqual(['axes', 'siteId', 'totals', 'worstAxes'])
  })
})

describe('an axis nobody measured', () => {
  it('scores null, not 100, when no checks ran against it', () => {
    // The single most important assertion in this file. Zero findings on an axis we never
    // looked at is not a clean bill of health, and scoring it 100 is the dishonest wall of
    // green circles the product exists to replace.
    const scorecard = build({ coverage: { crawl_health: { checksRun: 13 } } })

    expect(axis(scorecard, 'performance')).toMatchObject({
      status: 'not_measured',
      score: null,
    })
  })

  it('scores null, not 0, so a blank does not read as a failure either', () => {
    expect(axis(build({ coverage: {} }), 'authority')?.score).not.toBe(0)
  })

  it('never appears in the list of axes to look at first', () => {
    // "Go fix your unmeasured axis" is not advice, it is noise.
    const scorecard = build({ coverage: { crawl_health: { checksRun: 13 } } })

    expect(scorecard.worstAxes).not.toContain('local')
  })

  it('carries a note saying which data source is missing', () => {
    const scorecard = build({
      coverage: { performance: { checksRun: 0, note: 'Needs the CrUX connector.' } },
    })

    expect(axis(scorecard, 'performance')?.coverage.note).toContain('CrUX')
  })
})

describe('scoring a measured axis', () => {
  it('scores 100 when the checks ran and found nothing', () => {
    expect(axis(build(), 'crawl_health')).toMatchObject({ status: 'good', score: 100 })
  })

  it('never shows green while a critical is open, however much else passes', () => {
    // Thirteen passing crawl-health checks and one blocked AI search crawler must not
    // average out to a respectable number. The site is invisible in ChatGPT, and tidy
    // canonicals do not compensate. The severity ceiling is what enforces this.
    const scorecard = build({
      findings: [aFinding({ axis: 'ai_visibility', severity: 'critical', estimatedImpact: 5 })],
    })

    const scored = axis(scorecard, 'ai_visibility')

    // Impact 5 out of 100 means damage alone would have left this at 97.5.
    expect(scored?.score).toBeLessThanOrEqual(40)
    expect(scored?.status).toBe('poor')
  })

  it('lets volume drag a score down even with no critical', () => {
    const one = build({ findings: [aFinding({ severity: 'medium', estimatedImpact: 100 })] })
    const many = build({
      findings: Array.from({ length: 5 }, (_, i) =>
        aFinding({ id: `f_${i}`, severity: 'medium', estimatedImpact: 100 }),
      ),
    })

    expect(axis(many, 'crawl_health')!.score!).toBeLessThan(axis(one, 'crawl_health')!.score!)
  })

  it('costs a shaky detection less than a certain one, at every severity', () => {
    // This caught a real bug. The severity ceiling was originally set by severity alone, so
    // a 30%-confidence high capped the axis exactly as hard as a certain one, and confidence
    // stopped affecting the score entirely whenever the ceiling bound. For anything high or
    // critical that is nearly always, so a whole term of the model was dead in the cases that
    // mattered most. Asserting this at every severity is what keeps it dead-free: a version
    // that only checks 'medium' passes against the broken code.
    for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
      const certain = build({ findings: [aFinding({ severity, confidence: 1 })] })
      const shaky = build({ findings: [aFinding({ severity, confidence: 0.3 })] })

      expect(
        axis(shaky, 'crawl_health')!.score!,
        `confidence does not move the score at severity '${severity}'`,
      ).toBeGreaterThan(axis(certain, 'crawl_health')!.score!)
    }
  })

  it('will not let a half-sure critical disqualify an axis the way a certain one does', () => {
    // Severity says how bad it is if real. Confidence says whether it is real. A SimHash
    // near-duplicate we are half sure about has not earned the right to bury an axis the
    // way a 404 we watched happen has.
    const certain = build({
      findings: [aFinding({ severity: 'critical', confidence: 1, estimatedImpact: 10 })],
    })
    const halfSure = build({
      findings: [aFinding({ severity: 'critical', confidence: 0.5, estimatedImpact: 10 })],
    })

    expect(axis(certain, 'crawl_health')?.status).toBe('poor')
    expect(axis(halfSure, 'crawl_health')?.status).toBe('needs_work')
  })

  it('floors at 0 rather than going negative', () => {
    const scorecard = build({
      findings: Array.from({ length: 4 }, (_, i) =>
        aFinding({ id: `f_${i}`, severity: 'critical', estimatedImpact: 100 }),
      ),
    })

    expect(axis(scorecard, 'crawl_health')?.score).toBe(0)
  })

  it('lets an info finding cost nothing at all', () => {
    // TECH-020 tells the user their llms.txt is missing and says in its own falsification
    // note that fixing it will not move search rankings. A finding that admits it changes
    // nothing must not be allowed to change the score. Otherwise we are quietly selling
    // llms.txt as a ranking factor through the back door, which CLAUDE.md rule 8 forbids.
    const scorecard = build({
      findings: [
        aFinding({ axis: 'agent_readiness', severity: 'info', estimatedImpact: 100 }),
        aFinding({ id: 'f_2', axis: 'agent_readiness', severity: 'info', estimatedImpact: 100 }),
      ],
    })

    expect(axis(scorecard, 'agent_readiness')).toMatchObject({ score: 100, status: 'good' })
    expect(axis(scorecard, 'agent_readiness')?.findings.info).toBe(2)
  })
})

describe('which findings count', () => {
  it('still counts a finding whose PR is open, because it is not fixed until it is merged', () => {
    const scorecard = build({ findings: [aFinding({ status: 'pr_open', severity: 'critical' })] })

    expect(axis(scorecard, 'crawl_health')?.status).toBe('poor')
  })

  it.each(['merged', 'verified', 'rejected', 'wontfix'] as const)(
    'ignores a %s finding, so the score recovers once the work lands',
    (status) => {
      const scorecard = build({
        findings: [aFinding({ status, severity: 'critical', estimatedImpact: 100 })],
      })

      expect(axis(scorecard, 'crawl_health')).toMatchObject({ score: 100, status: 'good' })
      expect(scorecard.totals.critical).toBe(0)
    },
  )
})

describe('the backlog it hands the user', () => {
  it('names the top findings on an axis, highest priority first', () => {
    const scorecard = build({
      findings: [
        aFinding({ id: 'cheap_win', severity: 'high', estimatedEffort: 'trivial' }),
        aFinding({ id: 'expensive', severity: 'high', estimatedEffort: 'large' }),
      ],
    })

    expect(axis(scorecard, 'crawl_health')?.topFindings).toEqual(['cheap_win', 'expensive'])
  })

  it('caps the top findings so the inbox is a shortlist, not a dump', () => {
    const scorecard = build({
      findings: Array.from({ length: 10 }, (_, i) => aFinding({ id: `f_${i}` })),
      topFindingsPerAxis: 3,
    })

    expect(axis(scorecard, 'crawl_health')?.topFindings).toHaveLength(3)
  })

  it('orders the worst measured axes first', () => {
    const scorecard = build({
      findings: [
        aFinding({ axis: 'ai_visibility', severity: 'critical', estimatedImpact: 100 }),
        aFinding({ id: 'f_2', axis: 'content', severity: 'medium', estimatedImpact: 100 }),
      ],
    })

    expect(scorecard.worstAxes).toEqual(['ai_visibility', 'content'])
  })

  it('leaves worstAxes empty on a clean site', () => {
    expect(build().worstAxes).toEqual([])
  })

  it('totals the open findings by severity across every axis', () => {
    const scorecard = build({
      findings: [
        aFinding({ id: 'f_1', severity: 'critical' }),
        aFinding({ id: 'f_2', axis: 'content', severity: 'critical' }),
        aFinding({ id: 'f_3', axis: 'structure', severity: 'low' }),
      ],
    })

    expect(scorecard.totals).toMatchObject({ critical: 2, high: 0, low: 1 })
  })
})
