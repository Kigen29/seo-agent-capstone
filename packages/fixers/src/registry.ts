import { FixerRegistry } from './engine.js'
import { UnblockAiCrawlersFixer } from './fixers/ai-crawlers.js'
import { CanonicalRedirectFixer } from './fixers/canonical.js'
import { LlmsTxtFixer } from './fixers/llms-txt.js'
import { LocalBusinessFixer } from './fixers/local-business.js'
import { RemoveNoindexFixer } from './fixers/noindex.js'

/**
 * The built-in fixers, assembled.
 *
 * One place that knows which fixers exist, so the worker composes a registry with a single call
 * and adding a fixer is a line here rather than a change in the composition root. Every fixer is
 * registered against its rule; the registry picks the one whose `canFix` accepts a given finding.
 */
export function createFixerRegistry(): FixerRegistry {
  return new FixerRegistry().register(
    new UnblockAiCrawlersFixer(),
    new CanonicalRedirectFixer(),
    new RemoveNoindexFixer(),
    new LlmsTxtFixer(),
    new LocalBusinessFixer(),
  )
}
