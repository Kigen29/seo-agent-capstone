import type { Evidence } from './evidence.js'

/**
 * Evidence as one human-readable line.
 *
 * This lived privately inside `@seo/vcs`'s pull-request builder until the MCP server needed the
 * same thing, and copying it would have made three renderings of the same union: the PR body,
 * the dashboard panel, and the tool output. The dashboard's is legitimately separate because it
 * renders JSX and can use structure a line of text cannot. These two are the same job in the
 * same medium, so they are one function, here, next to the schema they describe.
 *
 * Every branch is a real observation rather than prose: a status code we saw, markup we parsed,
 * a number we measured. Whatever the fixer changed, the reader sees what was actually observed
 * to justify it, and can go and check it.
 *
 * The return type is annotated, which is load-bearing: an inferred return on a switch over a
 * discriminated union silently admits `undefined` when a variant is missed, and a caller
 * building a string gets "undefined" in their output rather than a compile error. That is not
 * hypothetical here; the dashboard's renderer shipped a blank panel for the `citation` variant
 * for exactly that reason.
 */
export function evidenceToText(evidence: Evidence): string {
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
    // The sample is the evidence here, not the verdict: "cited twice" means nothing without the
    // number of checks and the days they span, so the line leads with all three.
    case 'citation':
      return (
        `"${evidence.prompt}": cited in ${evidence.citedCount} of ${evidence.pollsRun} checks ` +
        `across ${evidence.daysPolled} days on ${evidence.engines.join(', ') || 'no engine'}` +
        (evidence.citedCompetitors.length > 0
          ? `; also cited: ${evidence.citedCompetitors.join(', ')}`
          : '') +
        (evidence.matchedSources.length > 0
          ? `; matched ${evidence.matchedSources.join(', ')}`
          : '') +
        (evidence.consensus
          ? `; the answers agreed on ${evidence.consensus.currency} ` +
            `${evidence.consensus.low.toLocaleString('en-US')} to ` +
            `${evidence.consensus.high.toLocaleString('en-US')}`
          : '')
      )
  }
}
