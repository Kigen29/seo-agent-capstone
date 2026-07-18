import type { Evidence, Finding } from '@seo/core'

/**
 * The pull-request body, and the enforcement point for CLAUDE.md rule 4.
 *
 * Every PR the agent opens must carry five things: the finding, the evidence, the expected
 * effect, the falsification condition, and a rollback note. This builder is the one place all
 * five are assembled, and it throws rather than render a body missing any of them. A fixer
 * cannot open a PR that skips the rollback note, because the provider builds the body here
 * before it calls GitHub, and a throw aborts the whole operation before a branch is created.
 *
 * The point is not the markdown. The point is that a reviewer, human or agent, is never asked
 * to trust a change whose evidence or undo path was left implicit.
 */

export interface PullRequestContent {
  finding: Finding
  expectedEffect: string
  rollback: string
}

export class IncompletePullRequestError extends Error {
  constructor(missing: string) {
    super(
      `Refusing to open a pull request: its body is missing the ${missing}. ` +
        'Every agent PR must carry the finding, the evidence, the expected effect, the ' +
        'falsification condition, and a rollback note (CLAUDE.md rule 4).',
    )
    this.name = 'IncompletePullRequestError'
  }
}

/** The PR title. Prefixed so a maintainer can see at a glance which PRs the agent opened. */
export function buildPrTitle(finding: Finding): string {
  return `[seo-agent] ${finding.title}`
}

/**
 * Render one piece of evidence into a human-readable line. The evidence type is a discriminated
 * union, so every branch is a real observation rather than prose: a status code we saw, markup
 * we parsed, a number we measured. Whatever the fixer changed, the reviewer sees what we
 * actually observed to justify it.
 */
function renderEvidence(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'http':
      return (
        `HTTP ${evidence.status} at ${evidence.url}` +
        (evidence.redirectChain.length > 0
          ? ` (redirect chain: ${evidence.redirectChain.join(' -> ')})`
          : '')
      )
    case 'markup':
      return (
        `At ${evidence.url}, ${evidence.locator}: ` +
        (evidence.snippet ? `\`${evidence.snippet}\`` : 'the element was absent')
      )
    case 'metric':
      return (
        `${evidence.metric} = ${evidence.value}${evidence.unit === 'score' ? '' : ' ' + evidence.unit}` +
        (evidence.percentile ? ` at the ${evidence.percentile}th percentile` : '') +
        (evidence.url ? ` (${evidence.url})` : '')
      )
    case 'file':
      return (
        `${evidence.path}${evidence.line ? `:${evidence.line}` : ''}` +
        (evidence.excerpt ? ` -> \`${evidence.excerpt}\`` : '')
      )
    case 'graph':
      return (
        `${evidence.url}: ${evidence.inboundInternalLinks} inbound internal link(s), ` +
        `click depth ${evidence.clickDepth ?? 'unreachable'}`
      )
    case 'search':
      return (
        `${evidence.query ? `"${evidence.query}"` : evidence.url}: ` +
        `position ${evidence.position}, ${evidence.impressions} impressions, ` +
        `${evidence.clicks} clicks (${evidence.startDate} to ${evidence.endDate})`
      )
  }
}

/**
 * Build the full PR body. Throws IncompletePullRequestError if any of the five required
 * sections would be empty, so the check runs before any branch or commit is created.
 */
export function buildPrBody(content: PullRequestContent): string {
  const { finding, expectedEffect, rollback } = content

  if (!finding.title.trim()) throw new IncompletePullRequestError('finding')
  if (!finding.falsification.trim()) throw new IncompletePullRequestError('falsification condition')
  if (!expectedEffect.trim()) throw new IncompletePullRequestError('expected effect')
  if (!rollback.trim()) throw new IncompletePullRequestError('rollback note')

  const affected =
    finding.affectedUrls.length > 0
      ? finding.affectedUrls.map((url) => `- ${url}`).join('\n')
      : '- (site-wide)'

  return [
    `## The finding`,
    '',
    `**${finding.ruleId}** (${finding.axis}, ${finding.severity}): ${finding.title}`,
    '',
    `Affected:`,
    affected,
    '',
    `## The evidence`,
    '',
    `This is what we actually observed, not a guess:`,
    '',
    `> ${renderEvidence(finding.evidence)}`,
    '',
    `## Expected effect`,
    '',
    expectedEffect.trim(),
    '',
    `## How we will know if this failed`,
    '',
    finding.falsification.trim(),
    '',
    `## Rollback`,
    '',
    rollback.trim(),
    '',
    '---',
    '',
    `Opened by the SEO agent. Nothing here reached your default branch: this is a pull ` +
      `request on a \`seo-agent/*\` branch, for a human to review and merge.`,
  ].join('\n')
}
