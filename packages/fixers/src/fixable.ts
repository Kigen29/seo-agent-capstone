import type { Finding } from '@seo/core'
import { createFixerRegistry } from './registry.js'

/**
 * Rules whose fix is written by a model rather than a registered deterministic fixer.
 *
 * TECH-021 is the original: one call for a homepage meta description, placed by a deterministic
 * head injection. The rest are written by the repository-reading agent (ADR-0030), which is shown
 * the files that cause a finding and proposes edits that are validated before a pull request opens.
 *
 * A literal here, and not an import, because `@seo/fixers` must not depend on `@seo/agent`: the
 * deterministic engine is the half that runs with no model and no API key, and that dependency
 * would be the first thread pulling it apart. `packages/agent/test/repo-fix.test.ts` asserts this
 * list is exactly TECH-021 plus the agent's own, so the two cannot drift silently.
 */
export const LLM_FIXABLE_RULE_IDS: readonly string[] = [
  'TECH-021',
  'TECH-006',
  'TECH-011',
  'TECH-019',
  'TECH-020',
  'TECH-023',
  'TECH-024',
  'TECH-025',
  'TECH-026',
  'TECH-027',
  'TECH-028',
  'TECH-032',
  'AGENT-002',
  'AGENT-003',
]

const registry = createFixerRegistry()

/**
 * Can this build open a pull request for this finding?
 *
 * Deliberately ignores the finding's own `fixable` flag and asks the fixers instead. That flag is
 * a promise recorded when the audit ran, and a promise recorded months ago is not evidence about
 * what the code can do today. When a rule's fixability changes, every finding already in the
 * database keeps the old answer, and the only place the disagreement shows up is a user clicking
 * "Fix with a PR" and waiting for a job that was doomed before it was queued. That is exactly what
 * happened to TECH-013.
 *
 * Both halves of the worker's fix path are represented, in the same order it tries them: a
 * registered fixer that parsed the structure, then the LLM content fixer. If this says yes and the
 * worker still finds nothing, that is a genuine per-finding "no safe fix" rather than a promise
 * the product could never have kept.
 */
export function canFixFinding(finding: Finding): boolean {
  return registry.hasFixerFor(finding) || LLM_FIXABLE_RULE_IDS.includes(finding.ruleId)
}
