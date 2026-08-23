import { describe, expect, it } from 'vitest'
import { canFixFinding, LLM_FIXABLE_RULE_IDS } from '../src/fixable.js'
import { createFixerRegistry } from '../src/registry.js'
import { makeFinding } from './fixtures.js'

/**
 * A TECH-002 finding whose evidence names a blocked agent.
 *
 * The generic fixture is a TECH-006 with an empty snippet, and `UnblockAiCrawlersFixer.canFix`
 * reads the blocked tokens out of the evidence rather than trusting the rule id. Overriding only
 * the id produces a finding no fixer accepts, which is a correct answer to the wrong question:
 * `canFixFinding` is per-finding, not per-rule, and a test that forgot that would assert nothing.
 */
const blockedCrawlerFinding = (overrides = {}) =>
  makeFinding({
    ruleId: 'TECH-002',
    evidence: {
      kind: 'markup',
      url: 'https://example.com/robots.txt',
      locator: '/robots.txt',
      // The shape packages/rules/src/rules/robots.ts actually writes, not a hand-drawn robots.txt.
      // The fixer parses this line to learn which agents to unblock, so a plausible-looking
      // snippet in the wrong format yields no tokens and the fixer correctly declines.
      snippet: 'Disallowed: OAI-SearchBot (OpenAI). Removed from ChatGPT answers.',
      observedAt: '2026-07-17T00:00:00.000Z',
      source: 'crawler',
    },
    ...overrides,
  })

/**
 * `canFixFinding` answers what a stored `fixable` flag only claims.
 *
 * The distinction is the whole point of the function, so the test that matters most is the one
 * where the two disagree: a finding recorded months ago as fixable, for a rule nothing can fix.
 * That row exists in production today and is what sent a user to a doomed job.
 */
describe('canFixFinding', () => {
  it('says yes for a rule with a registered fixer', () => {
    expect(canFixFinding(blockedCrawlerFinding())).toBe(true)
  })

  it('says yes for a rule the LLM content fixer writes', () => {
    expect(canFixFinding(makeFinding({ ruleId: 'TECH-021' }))).toBe(true)
  })

  it('says no for a rule nothing can fix, even when the finding claims otherwise', () => {
    // TECH-013 (orphan page) is the real case: no fixer, and rows in production still say true
    // because they were written before the rule was corrected. Deciding a promise for a user by
    // reading a flag the user's own data supplied is how that reached them.
    expect(canFixFinding(makeFinding({ ruleId: 'TECH-013', fixable: true }))).toBe(false)
  })

  it('ignores a stored false when a fixer does exist', () => {
    // The other direction of the same drift, and the reason this is not just a stricter flag
    // check: adding a fixer must start helping findings that were recorded before it existed.
    expect(canFixFinding(blockedCrawlerFinding({ fixable: false }))).toBe(true)
  })

  it('names only rules the registry does not already cover', () => {
    // A rule in both lists would mean the LLM is being offered work a parser already does, which
    // inverts ADR-0001. Cheap to assert and impossible to notice by reading.
    const registered = new Set(createFixerRegistry().ruleIds())
    for (const ruleId of LLM_FIXABLE_RULE_IDS) {
      expect(registered.has(ruleId), `${ruleId} has a deterministic fixer already`).toBe(false)
    }
  })
})
