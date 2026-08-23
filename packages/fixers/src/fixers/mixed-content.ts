import type { Finding } from '@seo/core'
import type { FileChange, FixContext, Fixer, FixResult } from '../engine.js'
import { headStrategyFor } from '../framework/detect.js'
import { HEAD_FILES } from '../head/inject.js'

/**
 * TECH-015: an HTTPS page loads a script, stylesheet or image over plain HTTP.
 *
 * The fix upgrades each insecure subresource URL to `https://`, wherever it is hardcoded in the
 * document head. It replaces the **exact URLs the finding recorded**, one string at a time, rather
 * than running a blanket `http://` → `https://` over the file: a blanket rewrite would also
 * rewrite a link in prose, an XML namespace, a schema.org `@context`, or a comment, none of which
 * are subresources and one of which (`http://schema.org`) is correct as it stands.
 *
 * It searches the head files for the framework, which is where scripts, stylesheets and fonts are
 * declared, and returns null when it cannot find any of the URLs there. A resource hardcoded in a
 * component three directories down is real and common; the repo reader fetches known paths and
 * cannot search for it, so the honest answer is that a human has to place this one.
 *
 * **This can break a resource, and the pull request says so.** Upgrading assumes the host serves
 * the same asset over TLS. For a script or a stylesheet that assumption costs nothing, because
 * browsers already block active mixed content and the resource is not loading today either way.
 * For an image it is a real risk: it may be displaying now and 404 over https. That judgement
 * belongs to the human reviewing the diff, which is why the URLs are listed in the body.
 */
export class MixedContentFixer implements Fixer {
  readonly ruleId = 'TECH-015'

  canFix(finding: Finding): boolean {
    return finding.ruleId === 'TECH-015' && insecureUrlsFrom(finding).length > 0
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const urls = insecureUrlsFrom(ctx.finding)
    if (urls.length === 0) return null

    const files: FileChange[] = []
    const upgraded = new Set<string>()

    for (const path of HEAD_FILES[headStrategyFor(ctx.framework)]) {
      const content = await ctx.read(path)
      if (content === null) continue

      let next = content
      for (const url of urls) {
        if (!next.includes(url)) continue
        next = next.split(url).join(secure(url))
        upgraded.add(url)
      }

      if (next !== content) files.push({ path, content: next })
    }

    // None of the recorded URLs are in a head file, so this one is hardcoded somewhere we cannot
    // reach. Reported honestly rather than guessed at.
    if (files.length === 0) return null

    const list = [...upgraded].sort()
    const missed = urls.filter((url) => !upgraded.has(url))

    return {
      files,
      expectedEffect:
        `Upgrades ${list.length} subresource URL(s) to https: ${list.join(', ')}. The browser ` +
        'console should be free of mixed-content warnings on the affected page, and blocked ' +
        'scripts and stylesheets should load again. ' +
        (missed.length > 0
          ? `Note that ${missed.length} of the reported resource(s) are not declared in the ` +
            `document head and are untouched by this change: ${missed.join(', ')}. This finding ` +
            'will keep firing until those are found and upgraded by hand. '
          : '') +
        'Check each host actually serves the asset over TLS before merging: an image that loads ' +
        'today over http can 404 over https, and that is a judgement this fixer cannot make.',
      rollback:
        'Revert the merge commit; every URL returns to http and the page loads exactly as it ' +
        'does now, mixed-content warnings included.',
    }
  }
}

/** The same URL over TLS. Only the scheme changes; host, port and path are untouched. */
function secure(url: string): string {
  return `https://${url.slice('http://'.length)}`
}

/**
 * The insecure resource URLs, read from the finding's own evidence.
 *
 * The rule records one line per resource as `<type>: <url>`, so the fixer reads what the rule
 * observed instead of re-deriving it from the page. That keeps the two in lockstep: a fixer that
 * found its own set could disagree with the finding it claims to be fixing.
 */
function insecureUrlsFrom(finding: Finding): string[] {
  if (finding.evidence.kind !== 'markup') return []

  const urls = new Set<string>()
  for (const line of finding.evidence.snippet.split('\n')) {
    const match = line.match(/^\s*\w+:\s*(http:\/\/\S+)\s*$/)
    if (match) urls.add(match[1]!)
  }

  // Longest first, so a URL that is a prefix of another cannot be rewritten inside it and leave
  // the longer one half-upgraded.
  return [...urls].sort((a, b) => b.length - a.length)
}
