import type { Audit, AuditProgress, FindingPage, KeywordIdeasResult, Site } from '@seo/api-client'
import { AXES, evidenceToText, type Finding, type Scorecard, type Severity } from '@seo/core'

/**
 * Turning API responses into text a model can read.
 *
 * Kept pure and separate from the tool handlers so it can be tested without a server, a
 * transport, or a network. Everything here takes data and returns a string.
 *
 * The governing constraint is that this output is charged for by the token and competes with
 * the model's own reasoning for room. The findings inbox learned the same lesson the expensive
 * way: it used to serialise every finding's full `affectedUrls` array into a list response,
 * which on a real tenant is megabytes to draw a table of titles. Into a context window that is
 * worse than slow, so the list renderers here emit counts and the detail renderer is the only
 * one that emits the URLs themselves.
 */

/** Severity order for display. Worst first, because that is the order a triager reads in. */
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/**
 * Severity counts as "critical 1, high 3", skipping the zeros.
 *
 * Printing every band including the empty ones turns a one-problem site into a wall of
 * "critical 0, high 0, medium 1, low 0, info 0", which reads as noise and buries the one
 * number that matters.
 */
function severityCounts(counts: Partial<Record<Severity, number>>): string {
  const parts = SEVERITIES.filter((s) => (counts[s] ?? 0) > 0).map((s) => `${s} ${counts[s]}`)
  return parts.length > 0 ? parts.join(', ') : 'none'
}

const pad = (text: string, width: number): string => text.padEnd(width)

/**
 * The eight-axis scorecard.
 *
 * There is deliberately no total, and adding one here would be a bug rather than a
 * convenience. The axes move independently: a site can have immaculate crawl health and be
 * invisible to every AI engine on the web, and averaging those into a 72 destroys the only
 * information the reader needed. An unmeasured axis prints a dash and says why, because a
 * zero and an absence look identical and mean opposite things.
 */
export function formatScorecard(scorecard: Scorecard): string {
  const lines = [
    'Scorecard (eight independent axes, no overall score by design):',
    '',
    ...AXES.map((axis) => {
      const entry = scorecard.axes.find((a) => a.axis === axis)
      if (!entry) return `  ${pad(axis, 18)}(missing)`

      const score = entry.score === null ? '-' : `${entry.score}/100`
      const head = `  ${pad(axis, 18)}${pad(entry.status, 13)}${pad(score, 9)}${entry.coverage.checksRun} checks`
      const findings = severityCounts(entry.findings)

      return [
        head,
        findings !== 'none' ? `      open findings: ${findings}` : undefined,
        entry.coverage.note ? `      ${entry.coverage.note}` : undefined,
      ]
        .filter((line) => line !== undefined)
        .join('\n')
    }),
    '',
    `Open findings in total: ${severityCounts(scorecard.totals)}`,
    scorecard.worstAxes.length > 0
      ? `Look at first: ${scorecard.worstAxes.join(', ')}`
      : 'Nothing is flagged as needing attention first.',
  ]

  return lines.join('\n')
}

export function formatSites(sites: Site[]): string {
  if (sites.length === 0) {
    return 'No sites. Add one in the dashboard, then run an audit against it.'
  }

  const blocks = sites.map((site) => {
    const audit = site.latestAudit
    return [
      `${site.url}`,
      `  siteId: ${site.id}`,
      `  repo: ${site.repoFullName ?? 'not connected (fix_finding needs one)'}`,
      `  Search Console: ${site.gscVerificationStatus ?? 'none'}`,
      audit
        ? `  latest audit: ${audit.id} (${audit.status}, ${audit.pagesCrawled} pages, ${audit.startedAt})`
        : '  latest audit: none yet, run_audit to create one',
    ].join('\n')
  })

  return `${sites.length} site(s):\n\n${blocks.join('\n\n')}`
}

/**
 * One page of the findings inbox.
 *
 * Every row leads with `rowId`, and that is not cosmetic. A finding carries two identifiers:
 * `id` is the rule key (`TECH-007#0`) and `rowId` is the UUID every route takes. A caller that
 * reaches for the obvious-looking one gets a 400, so the useful one goes first and the other is
 * not shown here at all.
 */
export function formatFindingList(page: FindingPage): string {
  if (page.total === 0) {
    return 'No findings match that query.'
  }

  const pages = Math.max(1, Math.ceil(page.total / page.pageSize))
  const header =
    `${page.total} finding(s), page ${page.page} of ${pages} ` +
    `(showing ${page.findings.length}), highest priority first:`

  const rows = page.findings.map((finding) =>
    [
      `${finding.rowId}`,
      `  [${finding.severity}] ${finding.ruleId}: ${finding.title}`,
      `  ${finding.siteUrl} · ${finding.axis} · impact ${finding.estimatedImpact} · ` +
        `effort ${finding.estimatedEffort} · ${finding.fixable ? 'fixable' : 'needs a human'} · ` +
        `${finding.status} · ${finding.affectedUrlCount} affected URL(s)`,
    ].join('\n'),
  )

  return `${header}\n\n${rows.join('\n\n')}`
}

/**
 * One finding in full: the only renderer that emits the affected URLs and the evidence.
 *
 * The falsification condition is always printed, and last, because it is the thing that makes
 * the finding checkable rather than an opinion. A reader who cannot see how the claim could be
 * wrong has been given advice, not a finding.
 */
export function formatFinding(finding: Finding & { rowId: string; auditId?: string }): string {
  const urls =
    finding.affectedUrls.length > 0
      ? finding.affectedUrls.map((url) => `  ${url}`).join('\n')
      : '  (site-wide)'

  return [
    `${finding.ruleId}: ${finding.title}`,
    '',
    `rowId: ${finding.rowId}   (this is what fix_finding takes)`,
    `axis: ${finding.axis} · severity: ${finding.severity} · confidence: ${finding.confidence}`,
    `impact: ${finding.estimatedImpact}/100 · effort: ${finding.estimatedEffort} · ` +
      `${finding.fixable ? 'fixable in code' : 'needs a human'}`,
    `status: ${finding.status}${finding.prUrl ? ` · ${finding.prUrl}` : ''}`,
    '',
    'Affected:',
    urls,
    '',
    'Evidence (what was actually observed):',
    `  ${evidenceToText(finding.evidence)}`,
    '',
    'How we would know this fix failed:',
    `  ${finding.falsification}`,
  ].join('\n')
}

export function formatAudit(audit: Audit): string {
  const head = [
    `Audit ${audit.id} of ${audit.siteUrl}`,
    `status: ${audit.status} · ${audit.pagesCrawled} pages · started ${audit.startedAt}` +
      (audit.completedAt ? ` · completed ${audit.completedAt}` : ''),
    audit.error ? `error: ${audit.error}` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join('\n')

  const scorecard = audit.scorecard
    ? `\n\n${formatScorecard(audit.scorecard)}`
    : '\n\nNo scorecard yet: the audit has not finished.'

  // Titles and ids only. The full evidence for every finding on a large audit is exactly the
  // kind of payload that crowds out the reasoning it was fetched to support; get_finding is
  // there for the one the reader actually cares about.
  const findings =
    audit.findings.length > 0
      ? `\n\n${audit.findings.length} finding(s), use get_finding for any of them:\n` +
        audit.findings
          .map((f) => `  ${f.rowId}  [${f.severity}] ${f.ruleId}: ${f.title}`)
          .join('\n')
      : '\n\nNo findings.'

  return head + scorecard + findings
}

/**
 * Keyword ideas, highest volume first.
 *
 * `competition` is printed as "ad competition" rather than the industry's "difficulty", because it
 * is an advertising metric and calling it difficulty invites a reader to plan organic work around
 * how many people bid on a term. A null is a dash, never a zero: the vendor not reporting a volume
 * and a keyword having no searches are different facts.
 */
export function formatKeywordIdeas(result: KeywordIdeasResult): string {
  if (result.note) return result.note
  if (result.ideas.length === 0) {
    return `No keyword ideas for "${result.seed}". The seed may be too narrow or too unusual.`
  }

  const num = (value: number | null, suffix = ''): string =>
    value === null ? '-' : `${value.toLocaleString('en-US')}${suffix}`

  const rows = [...result.ideas]
    .sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1))
    .map(
      (idea) =>
        `  ${pad(String(num(idea.searchVolume)), 10)}` +
        `${pad(idea.competition === null ? '-' : idea.competition.toFixed(2), 7)}` +
        `${pad(idea.cpc === null ? '-' : `$${idea.cpc.toFixed(2)}`, 9)}${idea.keyword}`,
    )

  return [
    `${result.ideas.length} keyword idea(s) for "${result.seed}", by monthly searches:`,
    '',
    `  ${pad('searches', 10)}${pad('ad comp', 7)}${pad('cpc', 9)}keyword`,
    ...rows,
    '',
    'Ad competition is how many advertisers bid on the term, not how hard it is to rank for.',
  ].join('\n')
}

export function formatProgress(progress: AuditProgress): string {
  return (
    `Audit ${progress.id}: ${progress.status}, ${progress.pagesCrawled} pages crawled. ` +
    (progress.finished
      ? 'Finished, so there is nothing left to poll for.'
      : 'Still running; poll again in a few seconds.')
  )
}
