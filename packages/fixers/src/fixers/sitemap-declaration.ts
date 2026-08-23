import type { Finding } from '@seo/core'
import type { FixContext, Fixer, FixResult } from '../engine.js'
import type { ReadRepoFile } from '../framework/detect.js'
import { ROBOTS_FILES } from '../root-files.js'

/**
 * TECH-003: robots.txt declares no sitemap, so crawlers have to guess where it is.
 *
 * One appended line, and the whole difficulty is in not appending it when it would be a lie.
 *
 * The rule fires whenever robots.txt names no sitemap, which says nothing about whether a sitemap
 * *exists*. The crawler cannot help either: it only expands sitemaps that robots.txt declared, so
 * by the time this finding is raised it has never looked for one. Declaring
 * `Sitemap: https://site/sitemap.xml` on that basis would point robots.txt at a 404 and turn a
 * missing declaration into a broken one, which Search Console reports as a sitemap it could not
 * read. Guessing is worse than the problem.
 *
 * So the evidence comes from the repository, which the fixer can read and the crawler could not:
 * a sitemap file that will be served, or the framework source that generates one. No such file,
 * no pull request.
 *
 * It edits an existing robots.txt and never creates one, the same posture as the AI-crawlers
 * fixer. A site with no robots.txt at all needs a decision about crawl policy, and this fixer is
 * about a discovery hint.
 */
export class SitemapDeclarationFixer implements Fixer {
  readonly ruleId = 'TECH-003'

  canFix(finding: Finding): boolean {
    return finding.ruleId === 'TECH-003' && originOf(finding) !== null
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const origin = originOf(ctx.finding)
    if (origin === null) return null

    // Only claim a sitemap we can see. This is the check that stops the fixer inventing one.
    if (!(await sitemapExists(ctx.read))) return null

    const found = await findRobots(ctx.read)
    if (!found) return null

    // Already declared: nothing to do, and re-running must never append a second line.
    if (/^\s*Sitemap\s*:/im.test(found.content)) return null

    const sitemapUrl = `${origin}/sitemap.xml`
    const eol = found.content.includes('\r\n') ? '\r\n' : '\n'
    const separator = found.content.endsWith('\n') ? '' : eol

    // Appended, never woven into an existing group. `Sitemap` is group-independent, so its
    // position carries no meaning, and appending cannot alter a single crawl rule a human wrote.
    const content = `${found.content}${separator}${eol}Sitemap: ${sitemapUrl}${eol}`

    return {
      files: [{ path: found.path, content }],
      expectedEffect:
        `robots.txt now declares ${sitemapUrl}, so a crawler finds the sitemap without guessing ` +
        'at its location. Search Console should report the sitemap as discovered, with a non-zero ' +
        'count of discovered URLs, within a few days. A sitemap is a discovery aid rather than a ' +
        'ranking factor, so expect better and faster coverage of pages with few internal links, ' +
        'not a change in position for pages already indexed.',
      rollback: `Revert the merge commit; the Sitemap line is removed and no crawl rule changes.`,
    }
  }
}

/** The site's origin, from the finding's own affected URL. Null when it is not a usable URL. */
function originOf(finding: Finding): string | null {
  const seed = finding.affectedUrls[0]
  if (!seed) return null

  try {
    return new URL(seed).origin
  } catch {
    return null
  }
}

/**
 * Files that mean a sitemap will actually be served at `/sitemap.xml`.
 *
 * Two kinds, and both are needed. A committed XML file is served as a static asset from whichever
 * directory the framework publishes. A framework source file generates one at build time, and is
 * the only signal available for a Next.js site, whose `app/sitemap.ts` produces `/sitemap.xml`
 * with nothing committed at all.
 *
 * Every entry here resolves to the same public URL, which is why the fixer does not have to work
 * out a path from whichever one matched.
 */
const SITEMAP_SOURCES = [
  'public/sitemap.xml',
  'static/sitemap.xml',
  'sitemap.xml',
  'src/sitemap.xml',
  'app/sitemap.ts',
  'app/sitemap.js',
  'src/app/sitemap.ts',
  'src/app/sitemap.js',
] as const

async function sitemapExists(read: ReadRepoFile): Promise<boolean> {
  for (const path of SITEMAP_SOURCES) {
    if ((await read(path)) !== null) return true
  }
  return false
}

async function findRobots(
  read: ReadRepoFile,
): Promise<{ path: string; content: string } | undefined> {
  for (const path of ROBOTS_FILES) {
    const content = await read(path)
    if (content !== null) return { path, content }
  }
  return undefined
}
