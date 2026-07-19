import { sameSite } from './citation.js'
import type { CitationCheck, PollTarget } from './types.js'

/**
 * Turn many polls into an honest verdict.
 *
 * The research is explicit: about 45% of citations appear in only one of three checks, so a single
 * poll is noise, and a citation is worth reporting only when it holds across polls over days. These
 * pure functions encode that. Nothing is reported as "cited" from a single lucky run.
 */

/** The minimum polls before a citation verdict is allowed at all. Below this we say so. */
export const MIN_POLLS = 3

/**
 * The share of polls that must cite the client for the citation to count as stable. Two of three is
 * the threshold: a citation seen once out of three is unstable and is reported as such, not as a
 * citation.
 */
export const STABLE_THRESHOLD = 2 / 3

export type Stability = 'insufficient' | 'absent' | 'unstable' | 'stable'

export interface PromptSummary {
  prompt: string
  pollsRun: number
  citedCount: number
  /** citedCount / pollsRun, the plain "cited in k of N" the report shows. */
  citationRate: number
  stability: Stability
}

/**
 * Summarise the polls for one prompt. Pass the checks for a single prompt gathered across the poll
 * window (several days). `insufficient` means we have not polled enough to say anything yet.
 */
export function summarisePrompt(checks: readonly CitationCheck[]): PromptSummary {
  const pollsRun = checks.length
  const citedCount = checks.filter((check) => check.cited).length
  const citationRate = pollsRun === 0 ? 0 : citedCount / pollsRun

  const stability: Stability =
    pollsRun < MIN_POLLS
      ? 'insufficient'
      : citedCount === 0
        ? 'absent'
        : citationRate >= STABLE_THRESHOLD
          ? 'stable'
          : 'unstable'

  return { prompt: checks[0]?.prompt ?? '', pollsRun, citedCount, citationRate, stability }
}

export interface ShareOfVoice {
  /** Times the client was cited across all the checks. */
  client: number
  competitors: { domain: string; citations: number }[]
  /** The client's citations as a fraction of all cited brands' citations. 0 when nobody was cited. */
  clientShare: number
}

/**
 * Share of voice across every check: the client's citation count against the competitors', so a
 * client can see not just whether they are cited but whether a rival owns the answer.
 */
export function shareOfVoice(checks: readonly CitationCheck[], target: PollTarget): ShareOfVoice {
  const client = checks.filter((check) => check.cited).length

  const competitors = target.competitors.map((domain) => ({
    domain,
    citations: checks.reduce(
      (count, check) =>
        count + (check.citedCompetitors.some((cited) => sameSite(cited, domain)) ? 1 : 0),
      0,
    ),
  }))

  const total = client + competitors.reduce((sum, competitor) => sum + competitor.citations, 0)
  return { client, competitors, clientShare: total === 0 ? 0 : client / total }
}
