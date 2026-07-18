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
