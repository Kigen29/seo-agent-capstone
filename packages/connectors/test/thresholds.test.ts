import { describe, expect, it } from 'vitest'
import { bandFor } from '../src/crux/thresholds.js'

/**
 * The boundaries themselves, tested at the exact values, because an off-by-one here silently
 * misclassifies every site that lands on a threshold. These numbers are Google's, unchanged
 * since INP replaced FID on 12 March 2024, and this is the test that fails loudly if anyone
 * "tidies" them.
 */
describe('Core Web Vitals bands', () => {
  it('classifies LCP: good <= 2.5s, poor > 4.0s', () => {
    expect(bandFor('lcp', 2500)).toBe('good') // exactly 2.5s is still good
    expect(bandFor('lcp', 2501)).toBe('needs_improvement')
    expect(bandFor('lcp', 4000)).toBe('needs_improvement') // exactly 4.0s is not yet poor
    expect(bandFor('lcp', 4001)).toBe('poor')
  })

  it('classifies INP: good <= 200ms, poor > 500ms', () => {
    expect(bandFor('inp', 200)).toBe('good')
    expect(bandFor('inp', 201)).toBe('needs_improvement')
    expect(bandFor('inp', 500)).toBe('needs_improvement')
    expect(bandFor('inp', 501)).toBe('poor')
  })

  it('classifies CLS: good <= 0.1, poor > 0.25', () => {
    expect(bandFor('cls', 0.1)).toBe('good')
    expect(bandFor('cls', 0.11)).toBe('needs_improvement')
    expect(bandFor('cls', 0.25)).toBe('needs_improvement')
    expect(bandFor('cls', 0.26)).toBe('poor')
  })
})
