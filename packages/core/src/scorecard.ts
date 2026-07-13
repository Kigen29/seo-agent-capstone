import { z } from 'zod'
import { AXES, axisSchema, type Axis } from './axis.js'
import type { Finding } from './finding.js'
import { prioritise } from './prioritise.js'
import { severitySchema, type Severity } from './severity.js'

/**
 * `not_measured` is the reason this type exists.
 *
 * Four of the eight axes have no checks behind them yet: performance needs CrUX, authority
 * needs a backlink source, local needs Google Business Profile, agent_readiness needs the
 * llms.txt and accessibility-tree checks. An axis we never looked at must say so. The
 * tempting bug is to score it 100, because zero findings divided by zero checks looks like
 * a clean bill of health, and a wall of eight green circles is exactly the dishonest
 * artefact every competitor ships.
 *
 * An unmeasured axis carries `score: null`. Not zero, which would read as failure, and not
 * 100, which would read as success. Null, which reads as the truth: we have not checked.
 */
export const axisStatusSchema = z.enum(['good', 'needs_work', 'poor', 'not_measured'])
export type AxisStatus = z.infer<typeof axisStatusSchema>

/**
 * What we actually looked at on this axis. Published alongside the score, because a score
 * without its coverage is unreadable: 100 from thirteen checks and 100 from one check are
 * very different claims, and the number alone cannot tell them apart.
 */
export const axisCoverageSchema = z.object({
  /** Deterministic checks registered for this axis. Zero means the axis is unmeasured. */
  checksRun: z.number().int().min(0),
  /** Why an axis is unmeasured, or what a thinly-covered one is still missing. */
  note: z.string().optional(),
})
export type AxisCoverage = z.infer<typeof axisCoverageSchema>

export const axisScoreSchema = z.object({
  axis: axisSchema,
  status: axisStatusSchema,
  /** 0 to 100, or null when the axis was not measured. Never fabricate this. */
  score: z.number().min(0).max(100).nullable(),
  coverage: axisCoverageSchema,
  /** How many open findings sit on this axis, by severity. */
  findings: z.record(severitySchema, z.number().int().min(0)),
  /** The findings driving the score, highest priority first. */
  topFindings: z.array(z.string()),
})
export type AxisScore = z.infer<typeof axisScoreSchema>

/**
 * Eight independent scores and no total.
 *
 * There is deliberately no overall number on this object, and adding one is a bug, not a
 * feature request. The axes move independently: a site can have immaculate crawl health
 * and be invisible to every AI engine on the web. Averaging those two into a 72 destroys
 * the only information the user needed.
 */
export const scorecardSchema = z.object({
  siteId: z.string().min(1),
  axes: z.array(axisScoreSchema).length(AXES.length),
  /** Open findings across every axis, by severity. */
  totals: z.record(severitySchema, z.number().int().min(0)),
  /** The axes a human should look at first: measured, and not good, worst score first. */
  worstAxes: z.array(axisSchema),
})
export type Scorecard = z.infer<typeof scorecardSchema>

/**
 * How much a single finding damages its axis, before confidence and impact scale it down.
 *
 * `info` is zero by definition. TECH-020 tells the user their llms.txt is missing and says
 * in its own falsification note that fixing it will not move search rankings. A finding
 * that admits it changes nothing must not be allowed to change the score either.
 */
const SEVERITY_DAMAGE: Record<Severity, number> = {
  critical: 50,
  high: 20,
  medium: 8,
  low: 3,
  info: 0,
}

/**
 * The worst open severity on an axis puts a ceiling on its score.
 *
 * Damage alone is not enough, because damage can be outvoted by volume: thirteen passing
 * crawl-health checks and one blocked OAI-SearchBot should not average out to a respectable
 * green number, since the site is invisible in ChatGPT and no amount of tidy canonicals
 * compensates. An axis carrying a confirmed critical never shows green.
 *
 * The ceiling is softened by confidence, and that softening is load-bearing rather than
 * decorative. Severity says how bad the problem is if it is real; confidence says whether
 * it is real at all. A SimHash near-duplicate we are 40% sure about has not earned the
 * right to disqualify an axis the way a 404 we watched happen has. Without the softening,
 * confidence stops affecting the score at all whenever the ceiling binds, which for
 * anything high or critical is nearly always, and a whole term of the model goes dead.
 */
const SEVERITY_CEILING: Record<Severity, number> = {
  critical: 40,
  high: 65,
  medium: 80,
  low: 90,
  info: 100,
}

const ceilingFor = (severity: Severity, confidence: number): number =>
  100 - (100 - SEVERITY_CEILING[severity]) * confidence

const GOOD = 90
const NEEDS_WORK = 60

/** Findings that are done, dismissed, or disproven do not weigh on the score. */
const OPEN_STATUSES = new Set(['open', 'pr_open'])

const emptyCounts = (): Record<Severity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
})

function statusFor(score: number): AxisStatus {
  if (score >= GOOD) return 'good'
  if (score >= NEEDS_WORK) return 'needs_work'
  return 'poor'
}

function scoreAxis(findings: readonly Finding[]): number {
  let damage = 0
  let ceiling = 100

  for (const finding of findings) {
    damage +=
      SEVERITY_DAMAGE[finding.severity] * finding.confidence * (finding.estimatedImpact / 100)
    ceiling = Math.min(ceiling, ceilingFor(finding.severity, finding.confidence))
  }

  return Math.max(0, Math.min(ceiling, 100 - damage))
}

export interface ScorecardInput {
  siteId: string
  findings: readonly Finding[]
  /**
   * Which axes we actually examined, and how many checks each got. Supplied by the caller
   * rather than inferred from the findings, because zero findings on a measured axis and
   * zero findings on an axis we never looked at are indistinguishable from the findings
   * alone, and confusing them is the exact failure this module exists to prevent.
   *
   * `@seo/rules` exports `ruleCoverage()` for the deterministic engine's contribution.
   */
  coverage: Partial<Record<Axis, AxisCoverage>>
  /** Findings named per axis, highest priority first. */
  topFindingsPerAxis?: number
}

/**
 * Build the eight-axis scorecard. Pure: same findings in, same scorecard out, no clock and
 * no network. The audit record stamps the time; this function does not need to know it.
 *
 * Known limitation, recorded here rather than hidden: `checksRun` counts the rules
 * registered for an axis, not the rules that found their input present. A rule that
 * returns early because robots.txt was unreachable still counts as a check run, so an
 * axis can look better covered than it was. Closing that gap means having rules report
 * "could not evaluate" distinctly from "evaluated, found nothing", which is a change to
 * the rule contract and is not in Sprint 1.
 */
export function buildScorecard(input: ScorecardInput): Scorecard {
  const limit = input.topFindingsPerAxis ?? 3
  const open = input.findings.filter((finding) => OPEN_STATUSES.has(finding.status))

  const axes: AxisScore[] = AXES.map((axis) => {
    const coverage = input.coverage[axis] ?? { checksRun: 0 }
    const onAxis = open.filter((finding) => finding.axis === axis)

    const findings = emptyCounts()
    for (const finding of onAxis) findings[finding.severity] += 1

    if (coverage.checksRun === 0) {
      return { axis, status: 'not_measured', score: null, coverage, findings, topFindings: [] }
    }

    const score = scoreAxis(onAxis)

    return {
      axis,
      status: statusFor(score),
      score,
      coverage,
      findings,
      topFindings: prioritise(onAxis)
        .slice(0, limit)
        .map((finding) => finding.id),
    }
  })

  const totals = emptyCounts()
  for (const finding of open) totals[finding.severity] += 1

  const worstAxes = axes
    .filter((axis) => axis.score !== null && axis.status !== 'good')
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map((axis) => axis.axis)

  return { siteId: input.siteId, axes, totals, worstAxes }
}
