import type { Finding, Framework } from '@seo/core'
import type { FixContext, Fixer, FixResult } from '../engine.js'
import { headStrategyFor, type ReadRepoFile } from '../framework/detect.js'
import { HEAD_FILES } from '../head/inject.js'
import { ROBOTS_FILES } from '../root-files.js'

/**
 * AGENT-001: the site has no llms.txt.
 *
 * The fix writes a well-formed llms.txt built from the pages the crawl already found (the finding
 * carries the site's most-linked pages in its affected URLs). It is deterministic: the file is
 * generated from data the finding hands over, and the file's own description keeps the rule-8
 * honesty, that llms.txt is agent-readiness infrastructure and Google Search ignores it.
 *
 * The file is placed where the framework serves static assets, and co-located with an existing
 * robots.txt when there is one (the two are neighbours at the site root, and a repo's robots.txt
 * is the surest signal of where root files live). It declines to overwrite an llms.txt that is
 * already there.
 */
export class LlmsTxtFixer implements Fixer {
  readonly ruleId = 'AGENT-001'

  canFix(finding: Finding): boolean {
    return finding.ruleId === 'AGENT-001' && finding.affectedUrls.length > 0
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    if (!this.canFix(ctx.finding)) return null

    const path = await targetPath(ctx.framework, ctx.read)
    if ((await ctx.read(path)) !== null) return null // already there; nothing to write

    const title =
      (await currentTitle(ctx.framework, ctx.read)) ?? hostOf(ctx.finding.affectedUrls[0]!)
    const content = renderLlmsTxt(title, ctx.finding.affectedUrls)

    return {
      files: [{ path, content }],
      expectedEffect:
        `Adds ${path}, an llms.txt listing the site's key pages so AI agents and crawlers can ` +
        'navigate it. This is agent-readiness infrastructure; Google Search ignores it, so expect ' +
        'no ranking change, only better handling by agents.',
      rollback: `Revert the merge commit; ${path} is removed and nothing else changes.`,
    }
  }
}

/** Where static files that serve at the site root live, per framework family. */
function staticDirFor(framework: Framework): string {
  if (framework === 'sveltekit' || framework === 'hugo') return 'static/'
  const strategy = headStrategyFor(framework)
  if (strategy === 'spa-index' || strategy === 'framework-head') return 'public/'
  // WordPress, Jekyll, server templates, and the universal case all serve the file from the root.
  return ''
}

/** The path to write llms.txt to: beside an existing robots.txt, else the framework's static dir. */
async function targetPath(framework: Framework, read: ReadRepoFile): Promise<string> {
  for (const robots of ROBOTS_FILES) {
    if ((await read(robots)) !== null) return robots.replace(/robots\.txt$/, 'llms.txt')
  }
  return `${staticDirFor(framework)}llms.txt`
}

/** The page's current title, read from the framework's head file, for the llms.txt heading. */
async function currentTitle(framework: Framework, read: ReadRepoFile): Promise<string | null> {
  for (const path of HEAD_FILES[headStrategyFor(framework)]) {
    const content = await read(path)
    if (content === null) continue
    const match = content.match(/<title>([^<]*)<\/title>/i)
    if (match && match[1]!.trim()) return match[1]!.trim()
  }
  return null
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Render a well-formed llms.txt: a heading, a one-line description, and the key pages as links. */
function renderLlmsTxt(title: string, urls: string[]): string {
  const host = hostOf(urls[0] ?? '')
  const lines = [
    `# ${title}`,
    '',
    `> Key pages on ${host}, listed for AI agents and crawlers. This file is agent-readiness ` +
      'infrastructure; Google Search ignores it.',
    '',
    '## Pages',
    '',
    ...urls.map((url) => `- [${labelFor(url, host)}](${url})`),
    '',
  ]
  return lines.join('\n')
}

/** A short, human label for a page: its path, or the host for the homepage. */
function labelFor(url: string, host: string): string {
  try {
    const { pathname } = new URL(url)
    return pathname === '/' ? host : pathname
  } catch {
    return url
  }
}
