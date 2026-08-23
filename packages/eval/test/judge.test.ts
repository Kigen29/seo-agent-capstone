import { describe, expect, it } from 'vitest'
import { checkJudgeIndependence } from '../src/judge.js'

/**
 * The acceptance criterion this file exists for: the judge runs on a different model family than
 * the model under test, "asserted, not assumed".
 */
describe('judge independence', () => {
  it('accepts a judge from a different provider', () => {
    const result = checkJudgeIndependence('anthropic:claude-sonnet-4', 'openai:gpt-4.1')
    expect(result.independent).toBe(true)
    expect(result.shared).toEqual([])
  })

  it('rejects a judge from the same family, even on a different model', () => {
    // The failure this guards is not two identical strings, which nobody would write. It is a
    // sibling: same lab, same pretraining lineage, same idea of a good sentence.
    const result = checkJudgeIndependence('openai:gpt-4.1', 'openai:gpt-4o')
    expect(result.independent).toBe(false)
    expect(result.shared).toEqual(['openai'])
  })

  it('rejects a collision anywhere in the fallback chain, not just at the head', () => {
    // The subtle one. Heads differ, so a check on first entries passes, and the arrangement holds
    // until the day OpenAI returns a 429 and Google quietly starts grading Google.
    const result = checkJudgeIndependence(
      'google:gemini-2.5-pro',
      'openai:gpt-4.1,google:gemini-2.5-pro',
    )
    expect(result.independent).toBe(false)
    expect(result.shared).toEqual(['google'])
  })

  it('never calls a custom endpoint independent of another custom endpoint', () => {
    // An OpenAI-compatible base URL could be a proxy in front of the model under test. Guessing
    // would repeat the mistake the whole check exists to prevent.
    const result = checkJudgeIndependence('custom:local?', 'custom:local?')
    expect(result.independent).toBe(false)
  })

  it('refuses an unset judge rather than treating it as unbiased', () => {
    const result = checkJudgeIndependence(undefined, 'openai:gpt-4.1')
    expect(result.independent).toBe(false)
    expect(result.reason).toContain('must both be configured')
  })

  it('explains what collided, so the message is actionable', () => {
    expect(checkJudgeIndependence('openai:gpt-4.1', 'openai:gpt-4o').reason).toContain(
      'Point LLM_JUDGE at a different provider',
    )
  })
})
