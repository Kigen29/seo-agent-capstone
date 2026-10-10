import type {
  AuditChanges,
  AuditHistoryEntry,
  CompetitorWatch,
  KeywordGapResult,
  SiteOutcomes,
  SiteSchedule,
  VisibilityReport,
} from '@seo/api-client'

/**
 * The reports, as text a model can read: what the dashboard's later pages show.
 *
 * The first set of tools covered the findings inbox and one audit, which was the product when
 * they were written. The product then grew an audit history, an AI-visibility report, an outcome
 * report, a competitor watch and a schedule, and an agent could reach none of them. These are
 * those pages.
 *
 * The same rules as `format.ts`, and one more that these reports make necessary: a figure keeps
 * its sample. "2 of 6 checks", never "33%", because a citation seen in one check of three is the
 * common case and a bare percentage hides whether a number rests on three observations or thirty.
 */

const day = (iso: string): string => iso.slice(0, 10)
const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`

const VERDICT: Record<VisibilityReport['prompts'][number]['stability'], string> = {
  stable: 'cited',
  unstable: 'cited unstably',
  absent: 'not cited',
  insufficient: 'still checking',
}

/**
 * AI visibility, question by question.
 *
 * A question with too few checks says so and gives no verdict. That is not a formatting choice:
 * about 45% of citations appear in only one check of three, so a verdict on two checks would be
 * a coin toss presented as a finding.
 */
export function formatVisibility(report: VisibilityReport): string {
  if (report.promptsConfigured === 0) {
    return (
      'No questions are tracked for this site, so AI visibility is not measured. That is an ' +
      'absence of measurement, not a score of zero. Questions are added in the dashboard, on ' +
      'the AI visibility page.'
    )
  }

  const lines = [
    `AI visibility over the last ${report.windowDays} days: ${report.promptsMeasured} of ` +
      `${report.promptsConfigured} question(s) have a verdict, from ${report.checksRun} check(s) ` +
      `on ${plural(report.daysPolled, 'day')}.`,
  ]
  if (report.engines.length > 0) lines.push(`Engines: ${report.engines.join(', ')}.`)
  if (report.note) lines.push('', report.note)

  if (report.prompts.length > 0) {
    lines.push(
      '',
      'Per question (cited in k of N checks, over D days):',
      ...report.prompts.map(
        (prompt) =>
          `  [${VERDICT[prompt.stability]}] ${prompt.citedCount} of ${prompt.pollsRun}, ` +
          `${plural(prompt.daysPolled, 'day')}: ${prompt.prompt}`,
      ),
      '',
      'A verdict needs at least three checks on three different days. "Still checking" is not ' +
        'a negative result.',
    )
  }

  if (report.share) {
    lines.push(
      '',
      `Share of voice: this site ${plural(report.share.client, 'citation')} ` +
        `(${Math.round(report.share.clientShare * 100)}% of those below).`,
      ...report.share.competitors.map(
        (competitor) => `  ${competitor.domain}: ${plural(competitor.citations, 'citation')}`,
      ),
      'This compares the site only with the competitors its owner named.',
    )
  }

  return lines.join('\n')
}

const OUTCOME: Record<SiteOutcomes['outcomes'][number]['status'], string> = {
  pr_open: 'waiting for review',
  merged: 'merged, being checked',
  verified: 'worked',
  rejected: 'did not work',
}

/**
 * What became of every fix, including the ones that did not work.
 *
 * The falsification condition is printed with each one. It was stated before the fix was written,
 * and it is what makes "worked" a checked claim and not the agent marking its own homework.
 */
export function formatOutcomes(result: SiteOutcomes): string {
  if (result.outcomes.length === 0) {
    return 'No fixes have been proposed for this site yet, so there are no outcomes to report.'
  }

  const { counts, rates } = result
  const decided = rates.merged + rates.closedUnmerged
  const lines = [
    `${plural(result.outcomes.length, 'fix', 'fixes')} proposed: ${counts.pr_open} waiting for ` +
      `review, ${counts.merged} merged and being checked, ${counts.verified} worked, ` +
      `${counts.rejected} did not work.`,
  ]
  if (decided > 0) {
    lines.push(
      `${rates.merged} of ${decided} decided pull request(s) were merged` +
        (rates.merged > 0 ? `, and ${rates.reverted} of those later reverted.` : '.'),
    )
  }

  for (const outcome of result.outcomes) {
    lines.push(
      '',
      `${outcome.rowId}  [${OUTCOME[outcome.status]}] ${outcome.ruleId}: ${outcome.title}`,
    )
    if (outcome.verification) {
      lines.push(
        `  ${outcome.verification.summary} Checked ${day(outcome.verification.verifiedAt)}.`,
      )
    } else if (outcome.note) {
      lines.push(`  ${outcome.note}`)
    }
    if (outcome.prUrl) lines.push(`  Pull request: ${outcome.prUrl}`)
    lines.push(`  It failed if: ${outcome.falsification}`)
  }

  return lines.join('\n')
}

/** A site's audits, newest first, each with what changed since the completed one before it. */
export function formatAuditHistory(audits: AuditHistoryEntry[]): string {
  if (audits.length === 0) return 'This site has never been audited. Use run_audit to start one.'

  const rows = audits.map((audit) => {
    const changes = audit.changes
      ? audit.changes.resolved === 0 && audit.changes.added === 0
        ? 'no change since the audit before'
        : `${audit.changes.resolved} resolved, ${audit.changes.added} new since the audit before`
      : audit.status === 'complete'
        ? 'first audit'
        : ''
    const body =
      audit.status === 'complete'
        ? `${plural(audit.pagesCrawled, 'page')}, ${plural(audit.findings, 'finding')}` +
          (changes ? `, ${changes}` : '')
        : (audit.error ?? 'not finished')
    return `  ${audit.id}  ${day(audit.startedAt)}  ${audit.status}: ${body}`
  })

  return [
    `${plural(audits.length, 'audit')}, newest first. Use get_audit for a scorecard, or ` +
      'audit_changes for what one resolved and raised:',
    '',
    ...rows,
  ].join('\n')
}

/**
 * What one audit resolved and raised, against the completed audit before it.
 *
 * Compared by finding identity, so "resolved" means an issue the earlier audit raised and this
 * one did not. The page counts are printed when this audit reached fewer pages, because an issue
 * on a page that was not reached shows as resolved without having been fixed.
 */
export function formatAuditChanges(changes: AuditChanges): string {
  if (!changes.previous) {
    return 'This is the first completed audit of the site, so there is nothing to compare it with.'
  }

  const list = (rows: AuditChanges['resolved']) =>
    rows.map((row) => `  ${row.rowId}  [${row.severity}] ${row.ruleId}: ${row.title}`)
  const moved = changes.scores.filter((point) => point.before !== point.after)
  const score = (value: number | null) =>
    value === null ? 'not measured' : String(Math.round(value))

  const lines = [
    `Compared with the audit of ${day(changes.previous.startedAt)}: ` +
      `${changes.resolved.length} resolved, ${changes.added.length} new, ` +
      `${changes.carried} still open from before.`,
  ]
  if (moved.length > 0) {
    lines.push(
      '',
      'Areas whose score moved:',
      ...moved.map((point) => `  ${point.axis}: ${score(point.before)} to ${score(point.after)}`),
    )
  }
  if (changes.resolved.length > 0) lines.push('', 'Resolved:', ...list(changes.resolved))
  if (changes.added.length > 0) lines.push('', 'New:', ...list(changes.added))
  if (changes.pages && changes.pages.after < changes.pages.before) {
    lines.push(
      '',
      `Caution: this audit reached ${changes.pages.after} pages and the one before reached ` +
        `${changes.pages.before}. An issue on a page that was not reached shows as resolved ` +
        'without having been fixed.',
    )
  }
  return lines.join('\n')
}

const CHANGE: Record<CompetitorWatch['batches'][number]['changes'][number]['kind'], string> = {
  title: 'title',
  description: 'meta description',
  h1: 'main heading',
  new_url: 'new page',
}

/**
 * What competitors changed, beside their AI citations either side of the change.
 *
 * The two counts are printed with a sentence saying what they are not. A change and a count in
 * the same row are exactly what gets read as cause and effect, and nothing here measures a cause
 * (ADR-0034).
 */
export function formatCompetitorWatch(watch: CompetitorWatch): string {
  if (watch.competitors.length === 0) {
    return 'No competitors are tracked for this site. They are named in the dashboard, on site setup.'
  }

  const lines = [
    `${plural(watch.competitors.length, 'competitor')} read every ${watch.intervalDays} days:`,
    ...watch.competitors.map((competitor) => {
      const state =
        competitor.lastSnapshotAt === null
          ? 'not read yet'
          : (competitor.note ??
            `read ${day(competitor.lastSnapshotAt)}, ${plural(competitor.pagesRead, 'page')}`)
      return `  ${competitor.domain}: ${state}`
    }),
  ]

  if (watch.batches.length === 0) {
    lines.push('', 'No changes recorded yet. A change needs two readings a week apart.')
    return lines.join('\n')
  }

  for (const batch of watch.batches) {
    lines.push(
      '',
      `${batch.competitor}, seen ${day(batch.detectedAt)}, ${plural(batch.changes.length, 'change')}:`,
    )
    for (const change of batch.changes) {
      lines.push(
        change.kind === 'new_url'
          ? `  new page: ${change.url}`
          : `  ${CHANGE[change.kind]} on ${change.url}: "${change.before ?? 'not present'}" to ` +
              `"${change.after ?? 'removed'}"`,
      )
    }
    const { citationsBefore: before, citationsAfter: after } = batch
    if (before.checks > 0 || after.checks > 0) {
      lines.push(
        `  Their AI citations: ${before.cited} of ${before.checks} checks in the ` +
          `${watch.windowDays} days before, ${after.cited} of ${after.checks} in the ` +
          `${watch.windowDays} days after${batch.afterComplete ? '' : ' so far'}. ` +
          'One followed the other in time. That is not evidence of a cause.',
      )
    }
  }
  return lines.join('\n')
}

/** Searches a competitor appears for and this site does not. */
export function formatKeywordGap(result: KeywordGapResult): string {
  if (result.note) return result.note
  if (result.keywords.length === 0) {
    return `Nothing ${result.competitor} ranks for is missing from this site, among the results looked up.`
  }

  const lines = [
    `${plural(result.keywords.length, 'search', 'searches')} ${result.competitor} appears for ` +
      'and this site does not:',
    '',
    ...result.keywords.map(
      (entry) =>
        `  ${(entry.searchVolume === null ? '-' : entry.searchVolume.toLocaleString('en-US')).padEnd(10)}` +
        `${(entry.competitorPosition === null ? '-' : `#${entry.competitorPosition}`).padEnd(6)}${entry.keyword}`,
    ),
  ]
  if (result.subtracted !== null) {
    lines.push(
      '',
      `${plural(result.subtracted, 'search', 'searches')} left out because Search Console shows ` +
        'this site already appears for them.',
    )
  }
  lines.push(
    '',
    "Some of these are the competitor's own brand searches, which cannot be ranked for.",
  )
  return lines.join('\n')
}

const STATE: Record<SiteSchedule['events'][number]['state'], string> = {
  done: 'done',
  failed: 'failed',
  running: 'running',
  due: 'due today',
  scheduled: 'scheduled',
}

const CADENCE: Record<SiteSchedule['auditCadence'], string> = {
  off: 'off (an audit runs only when asked for)',
  weekly: 'every 7 days',
  monthly: 'every 30 days',
}

/**
 * A site's calendar for one month.
 *
 * The daily AI-answers check is one line for its whole run, not a line a day: thirty identical
 * lines would spend the reader's context to say one thing.
 */
export function formatSchedule(schedule: SiteSchedule): string {
  const lines = [
    `Schedule for ${schedule.month} (${schedule.from} to ${schedule.to}), today is ` +
      `${schedule.today}. Days are UTC days; a run happens at some point during its day.`,
    `Scheduled audits: ${CADENCE[schedule.auditCadence]}.`,
  ]

  if (schedule.events.length === 0) {
    lines.push(
      '',
      'Nothing ran or is due in these weeks. Scheduled audits are off, no questions are tracked ' +
        'and no competitors are named.',
    )
    return lines.join('\n')
  }

  const upcomingPolls = schedule.events.filter(
    (event) => event.kind === 'visibility_poll' && event.state === 'scheduled',
  )
  const rest = schedule.events.filter((event) => !upcomingPolls.includes(event))

  const past = rest.filter((event) => event.state === 'done' || event.state === 'failed')
  const ahead = rest.filter((event) => event.state !== 'done' && event.state !== 'failed')
  const line = (event: SiteSchedule['events'][number]) =>
    `  ${event.day}  [${STATE[event.state]}] ${event.title}. ${event.detail}`

  if (ahead.length > 0 || upcomingPolls.length > 0) {
    lines.push('', 'Coming up:', ...ahead.map(line))
    const first = upcomingPolls[0]
    const last = upcomingPolls.at(-1)
    if (first && last) {
      lines.push(
        `  ${first.day} to ${last.day}  [scheduled, daily] ${first.title}. ${first.detail}`,
      )
    }
  }
  if (past.length > 0) lines.push('', 'Already run:', ...past.map(line))
  return lines.join('\n')
}
