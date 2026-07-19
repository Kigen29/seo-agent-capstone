export { detectFramework, headStrategyFor } from './framework/detect.js'
export type { ReadRepoFile, HeadStrategy } from './framework/detect.js'

export { FixerRegistry, PageCapExceededError, PAGE_CAP_WARN, PAGE_CAP_STOP } from './engine.js'
export type { Fixer, FixContext, FixResult, FileChange } from './engine.js'

export { createFixerRegistry } from './registry.js'
export { CanonicalRedirectFixer } from './fixers/canonical.js'
export { RemoveNoindexFixer } from './fixers/noindex.js'
export { UnblockAiCrawlersFixer } from './fixers/ai-crawlers.js'
export { LlmsTxtFixer } from './fixers/llms-txt.js'
export { LocalBusinessFixer } from './fixers/local-business.js'

export {
  injectHeadHtml,
  injectHeadTags,
  headContainsHtml,
  renderTag,
  HEAD_FILES,
} from './head/inject.js'
export type { HeadTag } from './head/inject.js'
