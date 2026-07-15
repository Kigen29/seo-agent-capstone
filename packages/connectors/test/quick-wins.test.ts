import { prioritise, type SearchEvidence } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { evaluateQuickWins, type QuickWinsInput } from '../src/gsc/quick-wins.js'
import type { SearchAnalyticsRow } from '../src/gsc/types.js'

const row = (over: Partial<SearchAnalyticsRow> & { keys: string[] }): SearchAnalyticsRow => ({
  clicks: 0,
  impressions: 1000,
  ctr: 0,
  position: 12,
  ...over,
})

const run = (rows: SearchAnalyticsRow[]) =>
  evaluateQuickWins({
    siteId: 's1',
    siteUrl: 'https://example.com',
    startDate: '2026-06-14',
    endDate: '2026-07-12',
    rows,
  } satisfies QuickWinsInput)

describe('evaluateQuickWins', () => {
  it('finds a page-2 ranking as a striking-distance opportunity', () => {
    const findings = run([
      row({ keys: ['seo audit tool'], position: 13, impressions: 2000, clicks: 5 }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('QW-STRIKING')
    expect(findings[0]?.title).toContain('page two')
    expect(findings[0]?.axis).toBe('content')
  })

  it('finds a page-1 ranking with a poor CTR as a title opportunity', () => {
    // Position 3 typically earns ~10%. Earning 1.5% at 4,000 impressions is a lot of missed
    // clicks that a title rewrite could recover, with no ranking work.
    const findings = run([
      row({ keys: ['best crm'], position: 3, impressions: 4000, ctr: 0.015, clicks: 60 }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('QW-CTR')
    expect(findings[0]?.estimatedEffort).toBe('small')
  })

  it('says nothing about a page-1 ranking whose CTR is healthy for its position', () => {
    // Position 3 earning 12% is doing fine. Flagging it would send someone to rewrite a title
    // that is already working, which is the "never optimise what is working" failure again.
    const findings = run([
      row({ keys: ['good page'], position: 3, impressions: 4000, ctr: 0.12, clicks: 480 }),
    ])

    expect(findings).toEqual([])
  })

  it('ignores rows below the impressions floor, so a handful of impressions is not a trend', () => {
    const findings = run([row({ keys: ['rare query'], position: 13, impressions: 10, clicks: 0 })])

    expect(findings).toEqual([])
  })

  it('says nothing about a top-of-page-one ranking that is already winning', () => {
    // Position 1, healthy CTR: there is no quick win here, and inventing one is noise.
    const findings = run([
      row({ keys: ['brand name'], position: 1, impressions: 5000, ctr: 0.35, clicks: 1750 }),
    ])

    expect(findings).toEqual([])
  })

  it('ignores rankings far down, beyond striking distance', () => {
    // Position 40 is not a quick win: reaching page one from there is a project, not a tweak.
    const findings = run([row({ keys: ['distant'], position: 40, impressions: 3000 })])

    expect(findings).toEqual([])
  })

  it('scores a bigger opportunity as more impactful, and the priority order reflects it', () => {
    const findings = prioritise(
      run([
        row({ keys: ['small'], position: 13, impressions: 300, clicks: 1 }),
        row({ keys: ['huge'], position: 13, impressions: 5000, clicks: 8 }),
      ]),
    )

    expect(findings[0]?.title).toContain('huge')
    expect(findings[0]!.estimatedImpact).toBeGreaterThan(findings[1]!.estimatedImpact)
  })

  it('records the real search numbers as evidence', () => {
    const finding = run([
      row({ keys: ['q'], position: 13, impressions: 2000, ctr: 0.004, clicks: 8 }),
    ])[0]!
    const evidence = finding.evidence as SearchEvidence

    expect(evidence).toMatchObject({
      kind: 'search',
      source: 'gsc',
      query: 'q',
      impressions: 2000,
      startDate: '2026-06-14',
      endDate: '2026-07-12',
    })
  })

  it('gives a finding a stable id from its query, not its position in the list', () => {
    // Search Console does not guarantee row order, so a positional id would drift between
    // runs and the verifier could not re-check the same finding after a fix. The id is the
    // query, so the same query yields the same id regardless of where it appears.
    const forward = run([
      row({ keys: ['alpha'], position: 13, impressions: 2000 }),
      row({ keys: ['beta'], position: 13, impressions: 2000 }),
    ])
    const reversed = run([
      row({ keys: ['beta'], position: 13, impressions: 2000 }),
      row({ keys: ['alpha'], position: 13, impressions: 2000 }),
    ])

    const idOf = (fs: typeof forward, q: string) => fs.find((f) => f.title.includes(q))?.id
    expect(idOf(forward, 'alpha')).toBe('QW-STRIKING#alpha')
    expect(idOf(forward, 'alpha')).toBe(idOf(reversed, 'alpha'))
  })

  it('warns in every falsification about the reporting lag', () => {
    const findings = run([
      row({ keys: ['a'], position: 13, impressions: 2000 }),
      row({ keys: ['b'], position: 3, impressions: 4000, ctr: 0.01, clicks: 40 }),
    ])

    expect(findings).toHaveLength(2)
    for (const finding of findings) {
      expect(finding.falsification).toMatch(/28 days/)
      expect(finding.falsification).toMatch(/lag/i)
    }
  })
})
