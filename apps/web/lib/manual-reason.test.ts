import { describe, expect, it } from 'vitest'
import { MANUAL_REASON, manualReasonFor } from './manual-reason'

/**
 * Why a finding has no pull-request button.
 *
 * The product's promise is a pull request, so every finding without one owes the reader a reason
 * that tells them what to do instead. These assert the reasons are the right ones for the cases
 * that are easiest to get wrong, and that no finding is ever left with no reason at all.
 */
describe('manualReasonFor', () => {
  it('says a missing backlink or mention is not something code can change', () => {
    expect(manualReasonFor({ ruleId: 'AUTH-001', axis: 'authority' }).reason).toBe('off_site')
    expect(manualReasonFor({ ruleId: 'AUTH-005', axis: 'authority' }).label).toBe(
      'Outside your code',
    )
  })

  it('says an orphan page or a robots conflict is a choice, not a missing capability', () => {
    expect(manualReasonFor({ ruleId: 'TECH-013', axis: 'structure' }).reason).toBe('your_decision')
    expect(manualReasonFor({ ruleId: 'TECH-001', axis: 'crawl_health' }).reason).toBe(
      'your_decision',
    )
  })

  it('says thin pages and image descriptions need what only the business has', () => {
    expect(manualReasonFor({ ruleId: 'TECH-029', axis: 'content' }).reason).toBe('your_content')
    expect(manualReasonFor({ ruleId: 'AGENT-004', axis: 'agent_readiness' }).reason).toBe(
      'your_content',
    )
  })

  it('says a page that only exists after JavaScript runs is a rebuild, not a patch', () => {
    expect(manualReasonFor({ ruleId: 'TECH-018', axis: 'crawl_health' }).reason).toBe(
      'beyond_a_patch',
    )
    expect(manualReasonFor({ ruleId: 'PERF-001', axis: 'performance' }).reason).toBe(
      'beyond_a_patch',
    )
  })

  it('always gives a reason, even for a rule nobody has classified', () => {
    const fallback = manualReasonFor({ ruleId: 'NEW-999', axis: 'crawl_health' })

    expect(fallback.label.length).toBeGreaterThan(0)
    expect(fallback.why.length).toBeGreaterThan(40)
  })

  it('never uses an em dash, and never just says "needs you"', () => {
    for (const { label, why } of Object.values(MANUAL_REASON)) {
      expect(`${label} ${why}`).not.toMatch(/—/)
      expect(label.toLowerCase()).not.toBe('needs you')
    }
  })
})
