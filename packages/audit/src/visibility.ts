import type { Finding } from '@seo/core'
import {
  evaluateVisibility,
  sameSite,
  MIN_DAYS,
  MIN_POLLS,
  type CitationCheck,
  type PollTarget,
  type PromptSummary,
  type PromptWindow,
  type ShareOfVoice,
} from '@seo/connectors'
import { visibilityChecks, visibilityPrompts, withTenant, type Database } from '@seo/db'
import { and, eq, gte } from 'drizzle-orm'

/**
 * How far back the citation window reaches.
 *
 * Long enough that a client who misses a couple of days still has a verdict, short enough that
 * the verdict is about the engines as they behave now. Answer engines change their retrieval
 * behaviour on no announcement and no schedule, so a citation from six weeks ago is not evidence
 * about today, and averaging it in would blunt exactly the change a client wants to see.
 */
export const VISIBILITY_WINDOW_DAYS = 14

export interface VisibilityResult {
  findings: Finding[]
  /** True only when at least one prompt cleared the sample and time floors. */
  measured: boolean
  /** How many prompts carry a real verdict. Counted as checks on the scorecard. */
  promptsMeasured: number
  /** What the axis should say about itself. Always present, measured or not. */
  note: string
}

/** The first day of the window, as the `YYYY-MM-DD` the `polled_on` date column stores. */
function windowStart(now: Date): string {
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - VISIBILITY_WINDOW_DAYS)
  return start.toISOString().slice(0, 10)
}

/** A percentage, for a note a human reads. */
const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`

/**
 * Measure the AI-visibility axis from the poll window this site has accumulated.
 *
 * Its own step, like performance and quick wins, and for the same reason: the data does not come
 * from the crawl. It comes from a saga that has been asking the engines the client's questions
 * once a day for days, and an audit run merely reads what that saga has gathered so far. An audit
 * never polls, which is why running one twice in an afternoon cannot manufacture a citation.
 *
 * The four ways this can come back without findings are four different facts, and collapsing them
 * would be the same dishonesty the performance axis refuses:
 *
 *   1. No prompts configured. We could measure this, nobody has said what to ask.
 *   2. Prompts configured, no checks yet. The saga has not run, or has run once. Asked, unanswered.
 *   3. Checks, but too few or over too few days. Genuinely polling, no verdict yet. This is the
 *      honest waiting state the whole axis is built around, and it lasts three days by design.
 *   4. A full window where every prompt is stably cited. That is the goal state, and it is the
 *      only one of the four that is good news.
 */
/** What one poll window looks like once the rows are grouped. */
interface LoadedWindow {
  /** Every check in the window, ungrouped. Used for the totals a note quotes. */
  rows: {
    prompt: string
    engine: string
    cited: boolean
    polledOn: string
  }[]
  /** How many prompts are configured, whether or not any has been polled. */
  configuredCount: number
  /** The engines seen in the window, sorted. */
  engines: string[]
  /** Distinct days the window spans. */
  days: number
  prompts: PromptWindow[]
}

/**
 * Load and group this site's poll window.
 *
 * Extracted because two callers need exactly this and neither should own it. `measureVisibility`
 * turns it into findings and a coverage note for an audit; `visibilityReport` turns it into the
 * numbers a screen shows. Grouping it twice would be two chances for the audit and the dashboard
 * to disagree about what the same checks mean, which is the worst possible bug for an axis whose
 * entire argument is that it does not overclaim.
 */
async function loadWindow(
  db: Database,
  options: { tenantId: string; siteId: string; domain: string },
  now: Date,
): Promise<LoadedWindow> {
  const rows = await withTenant(db, options.tenantId, (tx) =>
    tx
      .select({
        prompt: visibilityPrompts.prompt,
        engine: visibilityChecks.engine,
        cited: visibilityChecks.cited,
        basis: visibilityChecks.basis,
        citedCompetitors: visibilityChecks.citedCompetitors,
        sources: visibilityChecks.sources,
        answer: visibilityChecks.answer,
        polledOn: visibilityChecks.polledOn,
      })
      .from(visibilityChecks)
      .innerJoin(visibilityPrompts, eq(visibilityChecks.promptId, visibilityPrompts.id))
      .where(
        and(
          eq(visibilityChecks.siteId, options.siteId),
          gte(visibilityChecks.polledOn, windowStart(now)),
        ),
      ),
  )

  const configured = await withTenant(db, options.tenantId, (tx) =>
    tx
      .select({ prompt: visibilityPrompts.prompt })
      .from(visibilityPrompts)
      .where(eq(visibilityPrompts.siteId, options.siteId)),
  )

  // Group into one window per prompt.
  //
  // `days` is a set rather than a count because the same day can appear several times in one
  // window: two engines polled on Tuesday are two checks and one day, and the time floor cares
  // about days. `matchedSources` is filtered to what the parser could actually point at for this
  // client, which is what makes a finding checkable by hand: if no URL in that list is theirs,
  // the poller was wrong and the finding is void.
  interface Accumulator {
    prompt: string
    checks: CitationCheck[]
    engines: string[]
    answers: string[]
    matchedSources: string[]
    days: Set<string>
  }

  const windows = new Map<string, Accumulator>()

  for (const row of rows) {
    let window = windows.get(row.prompt)
    if (!window) {
      window = {
        prompt: row.prompt,
        checks: [],
        engines: [],
        answers: [],
        matchedSources: [],
        days: new Set<string>(),
      }
      windows.set(row.prompt, window)
    }

    window.checks.push({
      engine: row.engine,
      prompt: row.prompt,
      cited: row.cited,
      citedCompetitors: row.citedCompetitors,
      basis: row.basis,
    })
    window.answers.push(row.answer)
    window.days.add(row.polledOn)
    if (!window.engines.includes(row.engine)) window.engines.push(row.engine)

    if (row.cited) {
      for (const source of row.sources) {
        if (sameSite(source, options.domain) && !window.matchedSources.includes(source)) {
          window.matchedSources.push(source)
        }
      }
    }
  }

  const prompts: PromptWindow[] = [...windows.values()].map(({ days, ...window }) => ({
    ...window,
    daysPolled: days.size,
  }))

  return {
    rows,
    configuredCount: configured.length,
    engines: [...new Set(rows.map((row) => row.engine))].sort(),
    days: new Set(rows.map((row) => row.polledOn)).size,
    prompts,
  }
}

export async function measureVisibility(
  db: Database,
  options: { tenantId: string; siteId: string; domain: string; competitors: readonly string[] },
  now: Date = new Date(),
): Promise<VisibilityResult> {
  const { rows, configuredCount, engines, days, prompts } = await loadWindow(db, options, now)

  if (configuredCount === 0) {
    return {
      findings: [],
      measured: false,
      promptsMeasured: 0,
      note:
        'Not measured. AI visibility is measured by asking the answer engines the questions ' +
        'your customers actually ask, and this site has no prompts configured yet. Add them and ' +
        'the daily poll starts; the first verdict lands three days later, because a citation ' +
        'from a single poll is noise.',
    }
  }

  if (rows.length === 0) {
    return {
      findings: [],
      measured: false,
      promptsMeasured: 0,
      note:
        `Not measured yet. ${configuredCount} prompt(s) are configured and waiting for their ` +
        `first poll. A verdict needs ${MIN_POLLS} checks across ${MIN_DAYS} days, so the axis ` +
        `lights up three days after polling starts.`,
    }
  }

  const target: PollTarget = { domain: options.domain, competitors: [...options.competitors] }
  const report = evaluateVisibility({ siteId: options.siteId, target, prompts })

  if (report.promptsMeasured === 0) {
    return {
      findings: [],
      measured: false,
      promptsMeasured: 0,
      note:
        `Polling, no verdict yet. ${rows.length} check(s) across ${days} day(s) on ` +
        `${configuredCount} prompt(s), which is short of the ${MIN_POLLS} checks over ` +
        `${MIN_DAYS} days a citation verdict needs. Nothing is reported until then: about 45% ` +
        `of citations appear in only one of three checks, so an early answer would be a guess ` +
        `dressed as a measurement.`,
    }
  }

  // Every cited brand in the set, us included. Zero is a real state (nobody was cited for
  // anything), and dividing by it would turn an honest "nobody owns this" into NaN%.
  const allCitations =
    report.share.client + report.share.competitors.reduce((sum, c) => sum + c.citations, 0)

  const share =
    report.share.competitors.length === 0
      ? 'No competitors are configured, so there is no share of voice to report.'
      : `Share of voice: you ${percent(report.share.clientShare)}, ` +
        report.share.competitors
          .map(
            (competitor) =>
              `${competitor.domain} ` +
              percent(allCitations === 0 ? 0 : competitor.citations / allCitations),
          )
          .join(', ') +
        '.'

  return {
    findings: report.findings,
    measured: true,
    promptsMeasured: report.promptsMeasured,
    note:
      `Measured by polling ${engines.join(', ')} with your prompts: ${rows.length} checks over ` +
      `${days} days, on ${report.promptsMeasured} of ${configuredCount} prompt(s) with enough ` +
      `history to judge. You were cited in ${report.share.client} of ${rows.length} checks. ` +
      `${share} A citation is reported only when it holds in at least two of three checks across ` +
      `at least three days, because about 45% of citations appear in only one of three checks.`,
  }
}

/**
 * The AI-visibility numbers, for a screen rather than a scorecard.
 *
 * `measureVisibility` answers "what should the audit say about this axis" and returns findings and
 * a paragraph. This answers "what are the actual figures", and they are figures the product has
 * been computing every audit since Sprint 3 and discarding: per-prompt citation rate, how many
 * checks over how many days, the stability verdict, and share of voice against named competitors.
 * The Sprint 3 demo asks for exactly those three things on screen and they have never had one.
 *
 * Read live from `visibility_checks` rather than from a snapshot on the audit, and that is
 * deliberate. The poll saga writes a row a day, between audits, so a figure frozen at audit time
 * would be out of date by design. Everything here is computed by the same pure functions the audit
 * uses, over the same window, so the two cannot drift.
 */
export interface VisibilityReport {
  /** The poll window, so a reader knows what span the numbers describe. */
  windowDays: number
  /** How many prompts are configured, whether or not any has been polled. */
  promptsConfigured: number
  /** Prompts with enough history to carry a verdict. */
  promptsMeasured: number
  /** Every check in the window, and the days they span. */
  checksRun: number
  daysPolled: number
  engines: string[]
  /** One row per configured prompt, including the ones still accumulating. */
  prompts: PromptSummary[]
  /** Null when no competitors are configured, which is not the same as a zero share. */
  share: ShareOfVoice | null
  /** Why there is nothing to show, when there is nothing to show. */
  note?: string
}

export async function visibilityReport(
  db: Database,
  options: { tenantId: string; siteId: string; domain: string; competitors: readonly string[] },
  now: Date = new Date(),
): Promise<VisibilityReport> {
  const { rows, configuredCount, engines, days, prompts } = await loadWindow(db, options, now)

  const empty = {
    windowDays: VISIBILITY_WINDOW_DAYS,
    promptsConfigured: configuredCount,
    promptsMeasured: 0,
    checksRun: rows.length,
    daysPolled: days,
    engines,
    prompts: [],
    share: null,
  }

  if (configuredCount === 0) {
    return {
      ...empty,
      note:
        'No prompts configured. AI visibility is measured by asking the answer engines the ' +
        'questions your customers actually ask, and nobody has said what those are yet. Add them ' +
        'and the daily poll starts.',
    }
  }

  if (rows.length === 0) {
    return {
      ...empty,
      note:
        `${configuredCount} prompt(s) configured, none polled yet. A verdict needs ${MIN_POLLS} ` +
        `checks across ${MIN_DAYS} days, so the first one lands three days after polling starts.`,
    }
  }

  const target: PollTarget = { domain: options.domain, competitors: [...options.competitors] }
  const report = evaluateVisibility({ siteId: options.siteId, target, prompts })

  return {
    windowDays: VISIBILITY_WINDOW_DAYS,
    promptsConfigured: configuredCount,
    promptsMeasured: report.promptsMeasured,
    checksRun: rows.length,
    daysPolled: days,
    engines,
    // Every configured prompt, including those still accumulating: a prompt with two checks is
    // not missing, it is waiting, and showing only the ones with verdicts would make a site that
    // started polling yesterday look like it had no prompts at all.
    prompts: report.summaries,
    share: report.share.competitors.length > 0 ? report.share : null,
    ...(report.promptsMeasured === 0
      ? {
          note:
            `Polling, no verdict yet. ${rows.length} check(s) across ${days} day(s), short of ` +
            `the ${MIN_POLLS} checks over ${MIN_DAYS} days a verdict needs. About 45% of ` +
            'citations appear in only one of three checks, so an early answer would be a guess ' +
            'dressed as a measurement.',
        }
      : {}),
  }
}
