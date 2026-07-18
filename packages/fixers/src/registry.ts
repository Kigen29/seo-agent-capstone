import { FixerRegistry } from './engine.js'
import { CanonicalRedirectFixer } from './fixers/canonical.js'

/**
 * The built-in fixers, assembled.
 *
 * One place that knows which fixers exist, so the worker composes a registry with a single call
 * and adding a fixer is a line here rather than a change in the composition root. Every fixer is
 * registered against its rule; the registry picks the one whose `canFix` accepts a given finding.
 */
export function createFixerRegistry(): FixerRegistry {
  return new FixerRegistry().register(new CanonicalRedirectFixer())
}
