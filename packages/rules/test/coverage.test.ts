import { AXES } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { ruleCoverage } from '../src/coverage.js'
import { ALL_RULES } from '../src/registry.js'

describe('ruleCoverage', () => {
  it('accounts for every axis, including the ones we cannot measure yet', () => {
    expect(Object.keys(ruleCoverage()).sort()).toEqual([...AXES].sort())
  })

  it('accounts for every registered rule exactly once', () => {
    const total = Object.values(ruleCoverage()).reduce((sum, a) => sum + a.checksRun, 0)

    expect(total).toBe(ALL_RULES.length)
  })

  it('is derived from the registry, so a new rule cannot leave it stale', () => {
    const counted = ALL_RULES.filter((rule) => rule.axis === 'crawl_health').length

    expect(ruleCoverage().crawl_health.checksRun).toBe(counted)
  })

  it('reports zero checks on the axes with no data source connected', () => {
    const coverage = ruleCoverage()

    // These are honest blanks, not failures. Performance needs CrUX field data and authority
    // needs a backlink source. When either lands, the axis stops being blank here with no change
    // to this module, and this expectation is what will fail to tell us so. Agent readiness and
    // local were both in this list until their first rules (llms.txt, LocalBusiness) landed, which
    // is exactly the transition this test is here to catch.
    for (const axis of ['performance', 'authority'] as const) {
      expect(coverage[axis].checksRun).toBe(0)
    }
  })

  it('now measures agent readiness, and is honest that llms.txt is not a ranking factor', () => {
    // The first agent-readiness rule (llms.txt) flipped this axis from blank to measured. The
    // note must keep the rule-8 honesty: llms.txt helps agents, and Google Search ignores it.
    const coverage = ruleCoverage()
    expect(coverage.agent_readiness.checksRun).toBeGreaterThanOrEqual(1)
    expect(coverage.agent_readiness.note).toMatch(/ignores it|Google Search/i)
  })

  it('now measures local, and is honest that it only matters for a physical presence', () => {
    // The LocalBusiness rule flipped local from blank to partially measured. The note must keep
    // the honesty: it is only meaningful for a business with a physical presence.
    const coverage = ruleCoverage()
    expect(coverage.local.checksRun).toBeGreaterThanOrEqual(1)
    expect(coverage.local.note).toMatch(/physical presence/i)
  })

  it('says which missing data source is behind every unmeasured axis', () => {
    // An axis that says "not measured" and stops there is useless. The note has to tell the
    // user what connecting the source would buy them.
    for (const [axis, entry] of Object.entries(ruleCoverage())) {
      if (entry.checksRun === 0) {
        expect(entry.note, `${axis} is unmeasured and does not say why`).toBeTruthy()
      }
    }
  })

  it('admits that one robots.txt check is not a measurement of AI visibility', () => {
    // The most dangerous overclaim available to us. Checking that OAI-SearchBot is not
    // blocked proves the site *can* be cited. It says nothing about whether it *is*.
    expect(ruleCoverage().ai_visibility).toMatchObject({ checksRun: 1 })
    expect(ruleCoverage().ai_visibility.note).toMatch(/not yet poll/i)
  })
})
