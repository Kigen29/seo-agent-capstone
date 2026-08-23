import { canFixFinding } from '@seo/fixers'
import { describe, expect, it } from 'vitest'
import { e2eDrafts } from '../src/seed.js'

/**
 * The seed fixtures, held to the standard the rules are held to.
 *
 * `packages/fixers/test/fixable-promises.test.ts` proves no *rule* promises a fix nothing can
 * write. It says nothing about the fixtures, and the fixtures are what every screenshot, every
 * demo and every e2e run is taken against. Both seeded findings claimed `fixable: true`; TECH-006
 * has no fixer, and TECH-002's evidence was a hand-written robots.txt rather than the
 * `Disallowed: <token> (<operator>)` line the rule emits and the fixer parses. So the demo inbox
 * advertised a capability its own data could not exercise, in the one place a reviewer looks first.
 *
 * Note what this file does *not* assert. `seed.ts` now derives `fixable` from `canFixFinding`, so
 * checking that the two agree is a tautology: it restates the assignment and cannot fail. The
 * derivation already guarantees the fixture is honest. What it cannot guarantee is that the
 * fixture is still *useful*, because it will quietly record `false` for a finding whose evidence
 * drifted out of the shape a fixer recognises, and the demo would lose its fix button with every
 * check still green. That is the failure worth a test.
 */
describe('the e2e seed findings', () => {
  const drafts = e2eDrafts()

  it('seeds something, or the rest of this file asserts nothing', () => {
    expect(drafts.length).toBeGreaterThan(0)
  })

  it('seeds a TECH-002 whose evidence a fixer actually accepts', () => {
    const blocked = drafts.find((finding) => finding.ruleId === 'TECH-002')
    expect(blocked, 'the seeded inbox no longer contains a TECH-002 finding').toBeDefined()

    /**
     * The specific, breakable claim.
     *
     * `UnblockAiCrawlersFixer.canFix` reads the blocked agent tokens out of the evidence snippet
     * and declines when it finds none, so a snippet that merely looks like a robots.txt problem
     * fails here. Rewriting the snippet into something more readable is exactly the well-meant
     * change this catches: the seed would still load, the inbox would still render, and the fix
     * button would be gone.
     */
    expect(
      canFixFinding(blocked!),
      'no fixer accepts the seeded TECH-002. Its evidence snippet must carry the ' +
        '`Disallowed: <token> (<operator>)` lines that packages/rules/src/rules/robots.ts writes ' +
        'and packages/fixers/src/fixers/ai-crawlers.ts parses, not a hand-drawn robots.txt.',
    ).toBe(true)
  })

  it('keeps at least one fixable finding, because the demo turns on it', () => {
    // The seeded inbox exists to show the loop: a finding, a fix, a pull request. All-unfixable
    // fixtures would satisfy every other assertion here and demonstrate nothing.
    expect(drafts.some((finding) => finding.fixable)).toBe(true)
  })
})
