import { describe, expect, it } from 'vitest'
import { effortCost } from '../src/effort.js'
import { prioritise, priorityScore } from '../src/prioritise.js'
import { severityWeight } from '../src/severity.js'
import { aFinding } from './fixtures.js'

describe('priorityScore', () => {
  it('is severity_weight * confidence * impact / effort_cost', () => {
    const finding = aFinding({
      severity: 'high', // 8
      confidence: 0.5,
      estimatedImpact: 40,
      estimatedEffort: 'small', // 2
    })

    expect(priorityScore(finding)).toBe((8 * 0.5 * 40) / 2)
  })

  it('scales with the published weights rather than hardcoded numbers', () => {
    const finding = aFinding({ severity: 'critical', estimatedEffort: 'large' })

    expect(priorityScore(finding)).toBe(
      (severityWeight('critical') * finding.confidence * finding.estimatedImpact) /
        effortCost('large'),
    )
  })

  it('drives a low-confidence finding down, so a shaky detection must earn its place', () => {
    const certain = aFinding({ confidence: 1 })
    const shaky = aFinding({ confidence: 0.2 })

    expect(priorityScore(certain)).toBeGreaterThan(priorityScore(shaky))
  })

  it('drives an expensive finding down at equal impact', () => {
    const cheap = aFinding({ estimatedEffort: 'trivial' })
    const costly = aFinding({ estimatedEffort: 'large' })

    expect(priorityScore(cheap)).toBeGreaterThan(priorityScore(costly))
  })
})

describe('prioritise', () => {
  it('sorts highest priority first', () => {
    const low = aFinding({ id: 'low', severity: 'low', estimatedImpact: 10 })
    const critical = aFinding({ id: 'critical', severity: 'critical', estimatedImpact: 90 })
    const medium = aFinding({ id: 'medium', severity: 'medium', estimatedImpact: 50 })

    expect(prioritise([low, critical, medium]).map((f) => f.id)).toEqual([
      'critical',
      'medium',
      'low',
    ])
  })

  it('breaks ties on severity when impact and effort are equal', () => {
    const critical = aFinding({ id: 'critical', severity: 'critical' })
    const high = aFinding({ id: 'high', severity: 'high' })

    expect(prioritise([high, critical]).map((f) => f.id)).toEqual(['critical', 'high'])
  })

  it('lets a cheap high-impact fix outrank an expensive low-impact critical', () => {
    // This is intended, and it is worth stating out loud because it looks wrong.
    // Dividing by effort means severity is a weight, not a gate. Making severity a
    // gate would require w_critical > 1300 * w_medium, at which point impact and
    // effort stop affecting the order at all and the score is just severity.
    //
    // The safeguard is not a fatter weight, it is honest inputs: a genuine critical
    // (the site has blocked OAI-SearchBot and deleted itself from ChatGPT) carries a
    // high impact, and then it wins comfortably. See the next test.
    const expensiveCritical = aFinding({
      id: 'critical',
      severity: 'critical',
      estimatedImpact: 10,
      estimatedEffort: 'large',
    })
    const cheapMedium = aFinding({
      id: 'medium',
      severity: 'medium',
      estimatedImpact: 100,
      estimatedEffort: 'trivial',
    })

    expect(prioritise([expensiveCritical, cheapMedium])[0]?.id).toBe('medium')
  })

  it('puts a real critical above cheap busywork, because a real critical has real impact', () => {
    const blockedAiCrawlers = aFinding({
      id: 'blocks-ai-crawlers',
      severity: 'critical',
      estimatedImpact: 90,
      estimatedEffort: 'large',
    })
    const altText = aFinding({
      id: 'missing-alt-text',
      severity: 'medium',
      estimatedImpact: 8,
      estimatedEffort: 'trivial',
    })

    expect(prioritise([altText, blockedAiCrawlers])[0]?.id).toBe('blocks-ai-crawlers')
  })

  it('is stable, so the same crawl always produces the same backlog', () => {
    const a = aFinding({ id: 'a' })
    const b = aFinding({ id: 'b' })
    const c = aFinding({ id: 'c' })

    expect(prioritise([a, b, c]).map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const findings = [
      aFinding({ id: 'low', severity: 'low' }),
      aFinding({ id: 'critical', severity: 'critical' }),
    ]

    prioritise(findings)

    expect(findings.map((f) => f.id)).toEqual(['low', 'critical'])
  })
})
