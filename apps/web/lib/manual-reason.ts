/**
 * Why a finding has no "fix with a pull request" button, in words a person can act on.
 *
 * The inbox used to label every such finding "Needs you", which was true and useless: it did not
 * say whether the thing was outside the repository, waiting on a decision, or simply not built.
 * A product whose promise is "we send your repo a pull request" owes an explanation each time it
 * does not, and the explanation is different for a missing backlink than for an orphan page.
 *
 * Four reasons, because there are four different things a person does next:
 *
 *   off_site       nothing in the repository causes it; the work is outreach or a profile
 *   your_decision  the code change is easy, choosing it is not ours to do
 *   your_content   it needs words, images or facts only the business has
 *   beyond_a_patch it is real code work, but a rebuild or a hosting change, not a reviewable diff
 */
export type ManualReason = 'off_site' | 'your_decision' | 'your_content' | 'beyond_a_patch'

export const MANUAL_REASON: Record<ManualReason, { label: string; why: string }> = {
  off_site: {
    label: 'Outside your code',
    why: 'This is about other websites or services, so there is nothing in your repository for the agent to change. The finding says what to do instead.',
  },
  your_decision: {
    label: 'Your decision',
    why: 'The change itself is small, but choosing it is yours: the agent would have to guess which of two things you meant, and a wrong guess here costs more than the issue does.',
  },
  your_content: {
    label: 'Needs your content',
    why: 'This needs words, images or facts that only you have. The agent does not invent them, because invented content on your site is worse than the gap.',
  },
  beyond_a_patch: {
    label: 'Bigger than a patch',
    why: 'This is real work in your code or hosting, but it is a rebuild or a configuration change rather than a small edit someone can review in a pull request.',
  },
}

const BY_RULE: Record<string, ManualReason> = {
  // Two sources disagree, or a destination has to be chosen.
  'TECH-001': 'your_decision',
  'TECH-008': 'your_decision',
  'TECH-009': 'your_decision',
  'TECH-010': 'your_decision',
  'TECH-013': 'your_decision',
  'TECH-014': 'your_decision',
  'TECH-016': 'your_decision',
  'TECH-030': 'your_decision',
  'TECH-031': 'your_decision',
  // Words, pictures and facts.
  'TECH-012': 'your_content',
  'TECH-029': 'your_content',
  'TECH-034': 'your_content',
  'AGENT-004': 'your_content',
  'LOCAL-003': 'your_content',
  'PROD-001': 'your_content',
  'PROD-002': 'your_content',
  // How the site is built or served.
  'TECH-017': 'beyond_a_patch',
  'TECH-018': 'beyond_a_patch',
  'TECH-033': 'beyond_a_patch',
}

const BY_AXIS: Record<string, ManualReason> = {
  authority: 'off_site',
  ai_visibility: 'off_site',
  local: 'off_site',
  performance: 'beyond_a_patch',
  content: 'your_content',
}

/** The reason a finding the agent cannot fix is left to a person. Never undefined. */
export function manualReasonFor(finding: { ruleId: string; axis: string }): {
  reason: ManualReason
  label: string
  why: string
} {
  const reason = BY_RULE[finding.ruleId] ?? BY_AXIS[finding.axis] ?? 'your_decision'
  return { reason, ...MANUAL_REASON[reason] }
}
