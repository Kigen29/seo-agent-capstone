import type { Finding } from '@seo/core'
import type { FileChange, FixContext, Fixer, FixResult } from '../engine.js'
import { headStrategyFor } from '../framework/detect.js'
import { HEAD_FILES } from '../head/inject.js'

/**
 * TECH-007: a canonical that points at a URL which redirects.
 *
 * The safely-fixable shape of this finding is a host canonicalisation mismatch: the page declares
 * a canonical on one origin (say the bare apex) while the site actually serves on another (say
 * www), so the declared canonical 301s instead of returning 200 directly. The fix is to rewrite
 * that origin to the one that serves the live page, wherever it is hardcoded in the document head.
 *
 * It is deliberately narrow. A canonical pointing at a 404 is a different problem (the page does
 * not exist, and only a human knows what it should be), so `canFix` declines it rather than
 * opening a PR that cannot help. And it edits an origin string it derived from the finding's own
 * evidence, in the head files the framework is known to use; it never guesses. When it cannot find
 * that origin in a head file it returns null, which the worker reports honestly, rather than
 * inventing a location. This keeps the deterministic-first law (ADR-0001) on the write side.
 */
export class CanonicalRedirectFixer implements Fixer {
  readonly ruleId = 'TECH-007'

  canFix(finding: Finding): boolean {
    return planFor(finding) !== null
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const plan = planFor(ctx.finding)
    if (!plan) return null

    const { fromOrigin, toOrigin } = plan
    const files: FileChange[] = []

    // The canonical link lives in the document head, so the same files the injector targets are
    // where a hardcoded canonical origin will be. Rewriting the origin here also corrects any
    // og:url / twitter:url on the same origin, which is the right outcome: they should all point
    // at the address that actually serves the page.
    for (const path of HEAD_FILES[headStrategyFor(ctx.framework)]) {
      const content = await ctx.read(path)
      if (content === null || !content.includes(fromOrigin)) continue

      const next = rewriteOrigin(content, fromOrigin, toOrigin)
      if (next !== content) files.push({ path, content: next })
    }

    /**
     * The root document had nothing to change, so look where a canonical is built in code.
     *
     * Found on a real site: `index.html` already named the serving origin, and the tag itself
     * came from `src/components/SEO.tsx`, which joined a hard-coded apex origin to the current
     * path. The fixer read the one file it knew about, found nothing, and reported that no fix
     * could be generated for the most mechanical change in the product.
     *
     * Still a parser's job, with nothing guessed. Only files whose path says they are about the
     * document head are opened, a file is changed only if it contains both the redirecting origin
     * and the word "canonical", and the change is the same boundary-anchored origin rewrite as
     * above. A file that mentions the origin for another reason is never touched.
     */
    if (files.length === 0 && ctx.tree) {
      for (const path of headComponents(ctx.tree)) {
        const content = await ctx.read(path)
        if (content === null || !content.includes(fromOrigin) || !/canonical/i.test(content)) {
          continue
        }

        const next = rewriteOrigin(content, fromOrigin, toOrigin)
        if (next !== content) files.push({ path, content: next })
      }
    }

    if (files.length === 0) return null

    return {
      files,
      expectedEffect:
        `Absolute URLs on ${fromOrigin} now point at ${toOrigin}, the origin that serves the ` +
        'page with a 200, so the canonical resolves directly instead of through a redirect. ' +
        'Confirm in Search Console URL Inspection that the Google-selected canonical matches the ' +
        'declared one after the change is deployed.',
      rollback: `Revert the merge commit; every URL returns to ${fromOrigin} and nothing else changes.`,
    }
  }
}

/** How many candidate files are opened. Each is a request to the repository host. */
const MAX_HEAD_COMPONENTS = 12

const SOURCE_FILE = /\.(tsx?|jsx?|mjs|vue|svelte|astro|html?|php|erb|njk|liquid)$/i

/** Longest first, so `metadata` is tried before `meta`. */
const HEAD_WORDS = ['canonical', 'metadata', 'document', 'helmet', 'layout', 'head', 'meta', 'seo']

/**
 * Whether a path has a whole word saying the file is about the document head or its metadata.
 *
 * A word, not a substring, and the edges are read the way a filename is written: a separator or a
 * change of case. So `SEO.tsx`, `seoHelpers.ts` and `PageHead.tsx` match, and `Header.tsx` and
 * `museum.ts` do not. A plain case-insensitive pattern cannot say that, because the capital that
 * ends one word and starts the next is exactly what the flag throws away.
 */
function aboutTheHead(path: string): boolean {
  const lower = path.toLowerCase()

  return HEAD_WORDS.some((word) => {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      const before = at === 0 ? '/' : (path[at - 1] as string)
      const first = path[at] as string
      const after = path[at + word.length]

      const starts = /[/._-]/.test(before) || (/[a-z]/.test(before) && /[A-Z]/.test(first))
      const ends = after === undefined || /[A-Z/._-]/.test(after)
      if (starts && ends) return true
    }
    return false
  })
}

/** Never application code: dependencies, build output, tests, load tests, generated files. */
const NOT_SOURCE =
  /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.nuxt|vendor|k6|e2e|tests?|__tests__)\/|\.(test|spec|stories|d)\.[a-z]+$/i

/**
 * The files worth opening, most specific name first and then by path, so the same repository
 * always yields the same list and the cap cuts the least likely candidates.
 */
export function headComponents(tree: readonly string[]): string[] {
  const rank = (path: string): number =>
    /(seo|canonical)/i.test(path) ? 0 : /(head|meta|helmet)/i.test(path) ? 1 : 2

  return tree
    .filter((path) => SOURCE_FILE.test(path) && aboutTheHead(path) && !NOT_SOURCE.test(path))
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_HEAD_COMPONENTS)
}

interface OriginPlan {
  /** The origin the canonical is declared on, which redirects. */
  fromOrigin: string
  /** The origin that actually serves the page with a 200. */
  toOrigin: string
}

/**
 * Work out the origin rewrite from the finding, or return null when this is not the fixable shape.
 *
 * The finding's http evidence carries the canonical target as we resolved it: `url` is the final
 * URL it landed on (a 200), and a non-empty `redirectChain` means it got there via a redirect.
 * The declared canonical itself is the second affected URL (the rule records `[page, canonical]`).
 * A rewrite is safe only when the target is a live redirect to a different origin.
 */
function planFor(finding: Finding): OriginPlan | null {
  if (finding.ruleId !== 'TECH-007') return null

  const evidence = finding.evidence
  if (evidence.kind !== 'http') return null
  if (evidence.status !== 200 || evidence.redirectChain.length === 0) return null

  const declared = finding.affectedUrls[1] ?? finding.affectedUrls[0]
  if (!declared) return null

  let fromOrigin: string
  let toOrigin: string
  try {
    fromOrigin = new URL(declared).origin
    toOrigin = new URL(evidence.url).origin
  } catch {
    return null
  }

  // Same origin means the redirect changed the path, not the host, and a blunt origin rewrite
  // would not address it. Leave that for a fixer that understands the path mapping.
  if (fromOrigin === toOrigin) return null

  return { fromOrigin, toOrigin }
}

/**
 * Replace one origin with another, but only at a URL boundary.
 *
 * Without the boundary check, rewriting `https://site.com` would also corrupt
 * `https://site.com.evil.test`. A following character that continues a hostname (a letter, digit,
 * dot, or hyphen) means it is a different host, so it is left untouched.
 */
function rewriteOrigin(content: string, fromOrigin: string, toOrigin: string): string {
  const escaped = fromOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(new RegExp(`${escaped}(?![A-Za-z0-9.-])`, 'g'), toOrigin)
}
