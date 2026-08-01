import { describe, expect, it } from 'vitest'
import { evaluateVisibility, type PromptWindow } from '../src/visibility/evaluate.js'
import type { CitationCheck, PollTarget } from '../src/visibility/types.js'

const target: PollTarget = {
  domain: 'heartbeestsafaris.com',
  competitors: ['rivalsafaris.com', 'anothertour.co.ke'],
}

const check = (prompt: string, cited: boolean, citedCompetitors: string[] = []): CitationCheck => ({
  engine: 'perplexity',
  prompt,
  cited,
  citedCompetitors,
  basis: 'citations',
})

/** A window with sensible defaults, so each test states only what it is about. */
const windowFor = (partial: Partial<PromptWindow> & { prompt: string }): PromptWindow => ({
  checks: [],
  daysPolled: 3,
  engines: ['perplexity'],
  answers: [],
  matchedSources: [],
  ...partial,
})

const evaluate = (prompts: PromptWindow[]) =>
  evaluateVisibility({
    siteId: 'site-1',
    target,
    prompts,
    observedAt: '2026-08-01T00:00:00.000Z',
  })

describe('evaluateVisibility', () => {
  it('raises nothing at all from a sample too thin to have a verdict', () => {
    const report = evaluate([
      windowFor({
        prompt: 'best safari company in nairobi',
        checks: [check('best safari company in nairobi', false)],
        daysPolled: 1,
      }),
    ])

    // Not a hedged finding, not a low-confidence one. Nothing: it is not a fact about the
    // site yet, so it is not the site's problem.
    expect(report.findings).toEqual([])
    expect(report.summaries[0]?.stability).toBe('insufficient')
    expect(report.promptsMeasured).toBe(0)
  })

  it('raises nothing when the citation is stable, because that is the goal state', () => {
    const prompt = 'best safari company in nairobi'
    const report = evaluate([
      windowFor({
        prompt,
        checks: [check(prompt, true), check(prompt, true), check(prompt, false)],
      }),
    ])

    expect(report.findings).toEqual([])
    expect(report.summaries[0]?.stability).toBe('stable')
    expect(report.promptsMeasured).toBe(1)
  })

  it('raises a high-severity competitive loss when a rival is cited and we are not', () => {
    const prompt = 'best safari company in nairobi'
    const report = evaluate([
      windowFor({
        prompt,
        checks: [
          check(prompt, false, ['rivalsafaris.com']),
          check(prompt, false, ['rivalsafaris.com']),
          check(prompt, false, []),
        ],
      }),
    ])

    expect(report.findings).toHaveLength(1)
    const finding = report.findings[0]!
    expect(finding.ruleId).toBe('AIV-001')
    expect(finding.severity).toBe('high')
    expect(finding.title).toContain('rivalsafaris.com')
    expect(finding.fixable).toBe(false)
    expect(finding.evidence).toMatchObject({
      kind: 'citation',
      source: 'serp',
      pollsRun: 3,
      citedCount: 0,
      daysPolled: 3,
      citedCompetitors: ['rivalsafaris.com'],
    })
  })

  it('raises a low-severity open field when nobody in the set is cited', () => {
    const prompt = 'how much does a kenyan safari cost'
    const report = evaluate([
      windowFor({
        prompt,
        checks: [check(prompt, false), check(prompt, false), check(prompt, false)],
      }),
    ])

    const finding = report.findings[0]!
    expect(finding.ruleId).toBe('AIV-003')
    expect(finding.severity).toBe('low')
    // The distinction is the point: an open field is not a battle being lost.
    expect(finding.falsification).toContain('stop spending on it')
  })

  it('raises an unstable citation as its own, milder finding', () => {
    const prompt = 'best safari company in nairobi'
    const report = evaluate([
      windowFor({
        prompt,
        checks: [check(prompt, true), check(prompt, false), check(prompt, false)],
      }),
    ])

    const finding = report.findings[0]!
    expect(finding.ruleId).toBe('AIV-002')
    expect(finding.severity).toBe('medium')
    expect(finding.title).toContain('cited in 1 of 3 checks across 3 days')
  })

  it('carries the consensus range on the evidence when the answers named figures', () => {
    const prompt = 'how much does a kenyan safari cost'
    const report = evaluate([
      windowFor({
        prompt,
        checks: [
          check(prompt, false, ['rivalsafaris.com']),
          check(prompt, false),
          check(prompt, false),
        ],
        answers: [
          'A mid-range safari runs $2,000 to $4,000 per person.',
          'Budget on roughly $2,500 to $5,000.',
          'Most operators quote $3,000 to $6,000.',
        ],
      }),
    ])

    expect(report.findings[0]?.evidence).toMatchObject({
      consensus: { currency: 'USD', low: 2500, high: 5000, answers: 3 },
    })
  })

  it('omits the consensus range rather than inventing one when no figures were named', () => {
    const prompt = 'who is the best safari operator'
    const report = evaluate([
      windowFor({
        prompt,
        checks: [check(prompt, false), check(prompt, false), check(prompt, false)],
        answers: ['It depends what you want.', 'Several operators are well regarded.'],
      }),
    ])

    expect(report.findings[0]?.evidence).not.toHaveProperty('consensus')
  })

  it('gives a prompt the same finding id whatever else is being polled alongside it', () => {
    const prompt = 'best safari company in nairobi'
    const checks = [
      check(prompt, false, ['rivalsafaris.com']),
      check(prompt, false),
      check(prompt, false),
    ]
    const other = 'kenya safari packages'

    const alone = evaluate([windowFor({ prompt, checks })])
    const crowded = evaluate([
      windowFor({
        prompt: other,
        checks: [check(other, true), check(other, true), check(other, true)],
      }),
      windowFor({ prompt, checks }),
    ])

    // Positional ids would renumber the moment a client adds a prompt, and the verifier would
    // read that as one finding closing and another opening.
    expect(crowded.findings[0]?.id).toBe(alone.findings[0]?.id)
  })

  it('reports share of voice across the whole window', () => {
    const a = 'best safari company in nairobi'
    const b = 'kenya safari packages'
    const report = evaluate([
      windowFor({
        prompt: a,
        checks: [
          check(a, false, ['rivalsafaris.com']),
          check(a, false, ['rivalsafaris.com']),
          check(a, false),
        ],
      }),
      windowFor({
        prompt: b,
        checks: [check(b, true), check(b, true), check(b, false, ['anothertour.co.ke'])],
      }),
    ])

    expect(report.share.client).toBe(2)
    expect(report.share.competitors).toEqual([
      { domain: 'rivalsafaris.com', citations: 2 },
      { domain: 'anothertour.co.ke', citations: 1 },
    ])
    expect(report.share.clientShare).toBeCloseTo(2 / 5)
  })

  it('orders findings the same way whatever order the prompts arrive in', () => {
    const a = 'a prompt'
    const b = 'b prompt'
    const windows = [
      windowFor({ prompt: b, checks: [check(b, false), check(b, false), check(b, false)] }),
      windowFor({ prompt: a, checks: [check(a, false), check(a, false), check(a, false)] }),
    ]

    const forwards = evaluate(windows).findings.map((f) => f.id)
    const backwards = evaluate([...windows].reverse()).findings.map((f) => f.id)
    expect(forwards).toEqual(backwards)
  })
})
