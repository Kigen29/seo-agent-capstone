import { ALL_RULES } from '@seo/rules'
import { describe, expect, it } from 'vitest'
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
 * Rules that fall back to the LLM content fixer rather than a registered deterministic one.
 *
 * Kept as a literal rather than imported, because `@seo/fixers` must not depend on `@seo/agent`:
 * the deterministic engine is the half that runs with no model and no key, and a test dependency
 * would be the first thread pulling that apart. Mirrors the guard in
 * `packages/agent/src/content-fix.ts`, which returns null for anything but this.
 */
const LLM_FIXABLE = new Set(['TECH-021'])

/**
 * Declared fixable, with no fixer of either kind. Every one of these is a button that fails.
 *
 * Started at twelve. Two got the fixer they were waiting for (`TECH-003` declares the sitemap in
 * robots.txt, `TECH-015` upgrades insecure subresources), and six were honest `false` all along:
 * their fix is a decision rather than an edit, and they now say so on the finding instead of
 * offering a button.
 *
 * The four left are the ones that genuinely want a fixer nobody has written. They are all the
 * same shape, which is why they are the residue: each needs a model to write replacement *text*,
 * so they belong to the content fixer, which covers `TECH-021` and nothing else yet.
 */
const KNOWN_GAPS = new Set([
  'TECH-004', // Sitemap lists dead URLs. Removing them is easy; knowing whether the URL or the sitemap is wrong is not.
  'TECH-011', // Duplicate titles. Needs written replacements: the content fixer's job, and it covers only TECH-021.
  'TECH-019', // Missing or multiple h1. Needs a heading written, and a judgement about which one is the h1.
  'TECH-020', // Skipped heading level. Same, one level down.
])

describe('fixable rules and the fixers that must exist for them', () => {
  const registered = new Set(createFixerRegistry().ruleIds())
  const fixableRules = ALL_RULES.filter((rule) => rule.fixable)

  const canBeFixed = (ruleId: string) => registered.has(ruleId) || LLM_FIXABLE.has(ruleId)

  it('has fixable rules at all, or this suite asserts nothing', () => {
    expect(fixableRules.length).toBeGreaterThan(0)
  })

  it.each(fixableRules.map((rule) => [rule.id] as const))(
    '%s can be fixed, or is a known gap',
    (ruleId) => {
      expect(
        canBeFixed(ruleId) || KNOWN_GAPS.has(ruleId),
        `${ruleId} declares fixable: true and nothing can fix it. A user will be offered a "Fix ` +
          'with a PR" button that fails. Register a fixer, set fixable: false, or add it to ' +
          'KNOWN_GAPS with a note saying which of those it is waiting for.',
      ).toBe(true)
    },
  )

  it('lets the known-gap list shrink but never quietly grow', () => {
    // The ratchet. A gap that has been closed must leave the list, or the list stops describing
    // reality and the next person reads it as "these twelve are impossible".
    for (const ruleId of KNOWN_GAPS) {
      expect(
        canBeFixed(ruleId),
        `${ruleId} is in KNOWN_GAPS and now has a fixer. Remove it from the list.`,
      ).toBe(false)
    }
  })

  it('keeps every known gap pointing at a rule that still exists and still claims fixable', () => {
    // Otherwise a renamed or retired rule leaves a permanent excuse behind it.
    const fixableIds = new Set(fixableRules.map((rule) => rule.id))

    for (const ruleId of KNOWN_GAPS) {
      expect(
        fixableIds.has(ruleId),
        `${ruleId} is in KNOWN_GAPS but no rule with that id declares fixable: true any more.`,
      ).toBe(true)
    }
  })

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
