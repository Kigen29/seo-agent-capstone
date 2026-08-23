import { ALL_RULES } from '@seo/rules'
import { describe, expect, it } from 'vitest'
import { LLM_FIXABLE_RULE_IDS } from '../src/fixable.js'
import { createFixerRegistry } from '../src/registry.js'

/**
 * `fixable: true` is a promise made to a user, and this is the test that checks we can keep it.
 *
 * Writing it turned a one-rule bug into a thirteen-rule one. `TECH-006` was reported as a single
 * broken promise: declared fixable, no fixer, so the dashboard offered a "Fix with a PR" button,
 * the API returned 202, and the worker threw into a job log nobody reads. It is not one rule. Of
 * the eighteen rules declaring themselves fixable, six can actually be fixed.
 *
 * Nothing caught it because the two halves never met: the rule engine knows nothing about the
 * write path (correctly, ADR-0001), the fixers know nothing about the rule registry, and `fixable`
 * is just a boolean sitting between them.
 *
 * The list below is a ratchet, not an acceptance. It fails if a *new* rule joins it, and it fails
 * if an entry is fixed and left in place, so it can only shrink. The twelve are tracked as work,
 * and in the meantime a failed attempt now writes its reason onto the finding, so a user gets an
 * explanation instead of silence.
 */

/**
 * The LLM-backed rules, imported rather than restated.
 *
 * This was a literal here, duplicating the one in `src/fixable.ts`, which meant the test and the
 * code it guards each held their own copy of the same fact. Adding a rule to one and not the other
 * would leave this suite green while the product offered a button nothing answers.
 */
const LLM_FIXABLE = new Set(LLM_FIXABLE_RULE_IDS)

describe('fixable rules and the fixers that must exist for them', () => {
  const registered = new Set(createFixerRegistry().ruleIds())
  const fixableRules = ALL_RULES.filter((rule) => rule.fixable)

  const canBeFixed = (ruleId: string) => registered.has(ruleId) || LLM_FIXABLE.has(ruleId)

  it('has fixable rules at all, or this suite asserts nothing', () => {
    expect(fixableRules.length).toBeGreaterThan(0)
  })

  it.each(fixableRules.map((rule) => [rule.id] as const))(
    '%s declares fixable: true, so something can fix it',
    (ruleId) => {
      /**
       * No allowance list any more.
       *
       * There was one, holding twelve rules that promised a fix nothing could write. Four got a
       * fixer and eight were honest `false` all along, so the list emptied and was deleted rather
       * than left as an empty set inviting a new entry. Adding one back is now a visible act:
       * you would have to reintroduce the machinery, not append a line to it.
       */
      expect(
        canBeFixed(ruleId),
        `${ruleId} declares fixable: true and nothing can fix it. A user will be offered a "Fix ` +
          'with a PR" button, the API will accept, and the worker will fail. Register a fixer, ' +
          'or set fixable: false and give the finding the guidance the button used to imply.',
      ).toBe(true)
    },
  )

  it('registers no fixer for a rule that is not fixable', () => {
    // The other direction, and a different mistake: a fixer nothing can reach, because the API
    // refuses a fix request for an unfixable finding before the worker is ever asked.
    for (const rule of ALL_RULES.filter((candidate) => !candidate.fixable)) {
      expect(
        registered.has(rule.id),
        `${rule.id} has a registered fixer but declares fixable: false, so nothing can call it.`,
      ).toBe(false)
    }
  })
})
