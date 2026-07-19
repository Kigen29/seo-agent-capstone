import type { Finding } from '@seo/core'
import type { FileChange, FixContext, Fixer, FixResult } from '../engine.js'
import { headStrategyFor } from '../framework/detect.js'
import { HEAD_FILES } from '../head/inject.js'

/**
 * TECH-005: a page is marked noindex but also listed in the sitemap.
 *
 * The safely-fixable case is a `noindex` in the document head: a `<meta name="robots">` whose
 * content includes `noindex` (or `none`), which is the site telling Google not to index a page it
 * also asked Google to crawl. The fix removes just the indexing block, leaving any other directive
 * (a `nofollow`, say) intact, and drops the tag entirely when nothing else is left.
 *
 * It declines the header case. A `noindex` delivered by an `X-Robots-Tag` response header lives in
 * server or CDN config, not in the repo's HTML, so there is nothing here to safely edit and the
 * fixer returns null rather than open a PR that changes the wrong thing.
 */
export class RemoveNoindexFixer implements Fixer {
  readonly ruleId = 'TECH-005'

  canFix(finding: Finding): boolean {
    // Only the head-meta case. The header case is markup we did not write and cannot reach.
    return finding.ruleId === 'TECH-005' && finding.evidence.kind === 'markup'
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    if (!this.canFix(ctx.finding)) return null

    const files: FileChange[] = []
    for (const path of HEAD_FILES[headStrategyFor(ctx.framework)]) {
      const content = await ctx.read(path)
      if (content === null) continue

      const next = stripNoindex(content)
      if (next !== null && next !== content) files.push({ path, content: next })
    }

    if (files.length === 0) return null

    return {
      files,
      expectedEffect:
        'The affected pages are no longer marked noindex, so Google is free to index them again. ' +
        'Confirm in Search Console URL Inspection that the page reports as indexable; it should ' +
        'return to the index within a few weeks.',
      rollback: 'Revert the merge commit; the robots meta tag returns exactly as it was.',
    }
  }
}

/** The indexing-block tokens we remove. `none` is shorthand for `noindex, nofollow`. */
const INDEX_BLOCK = new Set(['noindex', 'none'])

/**
 * Remove the indexing block from the first robots meta tag in the head, or return null if there is
 * none to remove. A tag left with no meaningful directive is dropped along with its line; a tag
 * that still carries another directive keeps it.
 */
function stripNoindex(content: string): string | null {
  const metaRe = /<meta\b[^>]*>/gi

  for (const match of content.matchAll(metaRe)) {
    const tag = match[0]
    if (!/name\s*=\s*["']robots["']/i.test(tag)) continue

    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i)
    if (!contentMatch) continue

    const tokens = contentMatch[1]!
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    if (!tokens.some((token) => INDEX_BLOCK.has(token.toLowerCase()))) continue

    // `none` is itself noindex+nofollow, so removing the indexing block from a bare `none` leaves
    // nothing, and a tag whose only job was to noindex is removed whole rather than left empty.
    const kept = tokens.filter((token) => !INDEX_BLOCK.has(token.toLowerCase()))

    if (kept.length === 0) {
      // Nothing worth keeping: remove the whole tag, and the blank line it leaves behind.
      const start = match.index!
      const end = start + tag.length
      const before = content.slice(0, start).replace(/[ \t]*$/, '')
      const after = content.slice(end).replace(/^[ \t]*\r?\n/, '')
      return `${before}${after}`.replace(/\n{3,}/g, '\n\n')
    }

    const newTag = tag.replace(/content\s*=\s*["'][^"']*["']/i, `content="${kept.join(', ')}"`)
    return content.slice(0, match.index!) + newTag + content.slice(match.index! + tag.length)
  }

  return null
}
