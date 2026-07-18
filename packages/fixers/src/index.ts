export { detectFramework, headStrategyFor } from './framework/detect.js'
export type { ReadRepoFile, HeadStrategy } from './framework/detect.js'

export { FixerRegistry, PageCapExceededError, PAGE_CAP_WARN, PAGE_CAP_STOP } from './engine.js'
export type { Fixer, FixContext, FixResult, FileChange } from './engine.js'

export { injectHeadHtml, injectHeadTags, headContainsHtml, renderTag } from './head/inject.js'
export type { HeadTag } from './head/inject.js'
