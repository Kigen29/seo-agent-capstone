import type { Finding } from '@seo/core'

/**
 * Branch naming for agent-opened fixes.
 *
 * Every fix branch is `seo-agent/<finding-id>-<slug>` (CLAUDE.md rule 2). The prefix is not
 * decoration: it is how the provider recognises its own branches, how the webhook maps a
 * merged PR back to a finding, and how a human scanning the repo's branches can tell at a
 * glance what the agent touched. The finding id comes first so the mapping is exact, and the
 * slug follows so the branch is legible.
 */

export const BRANCH_NAMESPACE = 'seo-agent'

/**
 * A short, git-safe slug from a title. Lowercased, non-alphanumerics collapsed to single
 * hyphens, trimmed, and capped so a long title cannot produce a branch name git will reject.
 */
export function slugify(text: string, maxLength = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')

  return slug || 'fix'
}

/**
 * The stable prefix for a finding's branch, without the slug. The provider matches open PRs
 * on this so it can find a finding's PR even if the title, and therefore the slug, has since
 * changed.
 */
export function branchPrefixFor(findingId: string): string {
  return `${BRANCH_NAMESPACE}/${findingId}-`
}

/** The full branch name for a finding: `seo-agent/<id>-<slug>`. */
export function branchNameFor(finding: Pick<Finding, 'id' | 'title'>): string {
  return `${branchPrefixFor(finding.id)}${slugify(finding.title)}`
}
