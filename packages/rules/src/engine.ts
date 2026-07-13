import { parseFinding, prioritise, type Finding } from '@seo/core'
import { ALL_RULES } from './registry.js'
import type { Rule, RuleContext } from './types.js'

export interface EngineOptions {
  /** Run a subset. Used by the tests, and by the "re-check just this rule" path. */
  rules?: readonly Rule[]
}

/**
 * Run every rule over one crawl and return the findings, highest priority first.
 *
 * Zero LLM calls. Zero network. Pure. Run it twice on the same crawl and you get the
 * same findings in the same order, which is what makes a regression in the rule engine
 * detectable at all.
 */
export function runRules(context: RuleContext, options: EngineOptions = {}): Finding[] {
  const rules = options.rules ?? ALL_RULES
  const findings: Finding[] = []

  for (const rule of rules) {
    const drafts = rule.evaluate(context)

    drafts.forEach((draft, index) => {
      /**
       * The id is derived, not random. The same finding from the same crawl keeps the same
       * id across runs, so the verifier can ask "is TECH-002#0 still there?" after a fix,
       * and the UI does not shuffle on every refresh.
       */
      const finding = parseFinding({
        id: `${rule.id}#${index}`,
        siteId: context.siteId,
        ruleId: rule.id,
        axis: rule.axis,
        severity: rule.severity,
        estimatedEffort: rule.estimatedEffort,
        fixable: rule.fixable,
        status: 'open',
        ...draft,
      })

      findings.push(finding)
    })
  }

  return prioritise(findings)
}
