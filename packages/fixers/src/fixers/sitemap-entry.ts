import type { Finding } from '@seo/core'
import type { FixContext, Fixer, FixResult } from '../engine.js'
import { SITEMAP_FILES } from '../root-files.js'

/**
 * TECH-004: the sitemap lists a URL that 404s, redirects, or is noindexed.
 *
 * Only the **redirect** case is fixed, and only in a committed sitemap. That narrowness is the
 * point, and it mirrors the canonical fixer, which fixes a canonical that redirects and declines
 * one that 404s.
 *
 * A redirecting entry has one right answer. A sitemap is a list of the canonical, 200-status URLs
 * a site wants indexed, so an entry that redirects should be the address it redirects to. Nobody
 * has to decide anything, and the finding's own evidence carries both halves: `affectedUrls[0]` is
 * the URL the sitemap lists and `evidence.url` is where it actually landed.
 *
 * The other two cases are genuinely ambiguous and are declined:
 *
 *   - **404.** Either the page should exist and is missing, or it should not be listed. Removing
 *     the entry hides a dead page rather than fixing it, and an agent cannot tell which happened.
 *   - **noindex.** Either the sitemap is wrong to list it, or the noindex is wrong and the page
 *     should rank. That contradiction is `TECH-005`'s subject, and it needs a human either way.
 *
 * A generated sitemap (`app/sitemap.ts`) is declined too: it returns an array from code, and
 * rewriting that safely is a different job from editing markup.
 */
export class SitemapEntryFixer implements Fixer {
  readonly ruleId = 'TECH-004'

  canFix(finding: Finding): boolean {
    return redirectPlanFor(finding) !== null
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const plan = redirectPlanFor(ctx.finding)
    if (!plan) return null

    for (const path of SITEMAP_FILES) {
      const content = await ctx.read(path)
      if (content === null || !content.includes(plan.listed)) continue

      // Exact string replacement of one URL. A sitemap is XML, and rewriting it through a parser
      // would reformat every other entry and bury the one line that changed in a diff nobody can
      // review. The listed URL is a full absolute URL, so it cannot collide with a fragment of
      // another entry.
      const next = content.split(plan.listed).join(plan.destination)
      if (next === content) continue

      return {
        files: [{ path, content: next }],
        expectedEffect:
          `The sitemap now lists ${plan.destination} instead of ${plan.listed}, which redirects ` +
          'to it. A sitemap is a list of canonical 200-status URLs, so crawlers stop being sent ' +
          'through a redirect to reach it, and Search Console should stop excluding the entry as ' +
          '"Page with redirect". The redirect itself is untouched and any existing link to the ' +
          'old URL keeps working.',
        rollback: `Revert the merge commit; the sitemap lists ${plan.listed} again.`,
      }
    }

    // No committed sitemap contains it: either the sitemap is generated from code, or it lives
    // somewhere the reader cannot fetch. Reported honestly rather than guessed at.
    return null
  }
}

interface RedirectPlan {
  /** The URL the sitemap lists, which redirects. */
  listed: string
  /** Where it actually lands, which is what the sitemap should say. */
  destination: string
}

/**
 * The rewrite, or null when this finding is not the redirect-shaped one.
 *
 * `redirectChain` being non-empty is what distinguishes a redirecting entry from a 404 or a
 * noindexed one, and a 200 final status is what makes the destination worth listing. Both come
 * from the rule's own evidence, so the fixer re-derives nothing and cannot disagree with the
 * finding it is fixing.
 */
function redirectPlanFor(finding: Finding): RedirectPlan | null {
  if (finding.ruleId !== 'TECH-004') return null

  const evidence = finding.evidence
  if (evidence.kind !== 'http') return null
  if (evidence.redirectChain.length === 0) return null
  if (evidence.status !== 200) return null

  const listed = finding.affectedUrls[0]
  if (!listed || listed === evidence.url) return null

  return { listed, destination: evidence.url }
}
