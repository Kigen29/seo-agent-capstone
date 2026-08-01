import { parseFinding, type Finding } from '@seo/core'
import { consensusRange } from './consensus.js'
import { shareOfVoice, summarisePrompt, MIN_DAYS, MIN_POLLS } from './stability.js'
import type { PromptSummary, ShareOfVoice } from './stability.js'
import type { CitationCheck, PollTarget } from './types.js'

/**
 * Turn a poll window into AI-visibility findings, deterministically.
 *
 * The judge, kept apart from the polling that fetches, exactly as `crux/evaluate.ts` is kept
 * apart from `crux/client.ts`: the opinion is a pure function of observations, so it is tested
 * against fixtures with no network, no key, and no spend, and the same window always yields the
 * same findings.
 *
 * Three things it refuses to do, each of them the industry norm:
 *
 *   1. Report a citation from a thin sample. A prompt polled fewer than three times, or over
 *      fewer than three days, produces no finding at all, not a hedged one. It is not a fact
 *      about the site yet, so it is not the site's problem.
 *   2. Treat "not cited" as one thing. Not cited while a rival is cited is a competitive loss
 *      and a high-severity finding. Not cited where nobody in the set is cited is an open field,
 *      and a low-severity one. Collapsing them would send a client to fight a battle nobody is
 *      in, or ignore one they are losing.
 *   3. Claim a fix. Nothing here is `fixable`: the remedy is the page the answer gets built
 *      from, which is content work on a specific commercial page, not a templated diff. Marking
 *      these fixable would put a generated PR in front of a human for a problem no generator
 *      understands.
 */

/** Everything observed for one prompt across the poll window. */
export interface PromptWindow {
  prompt: string
  /** Every parsed check for this prompt in the window, one per engine per day. */
  checks: readonly CitationCheck[]
  /** How many distinct days those checks span. The time floor is checked against this. */
  daysPolled: number
  /** The engines that answered, deduplicated. */
  engines: readonly string[]
  /** The answer texts, kept only so the consensus range can be parsed out of them. */
  answers: readonly string[]
  /** Cited source URLs the parser matched to the client. Empty when never cited. */
  matchedSources: readonly string[]
}

export interface VisibilityReport {
  findings: Finding[]
  /** One summary per prompt, including the ones with no verdict yet. */
  summaries: PromptSummary[]
  /** Share of voice across every check in the window. */
  share: ShareOfVoice
  /** Prompts that cleared the sample and time floors, so carry a real verdict. */
  promptsMeasured: number
}

export interface EvaluateVisibilityInput {
  siteId: string
  target: PollTarget
  prompts: readonly PromptWindow[]
  /** Injected so a test can assert on evidence without freezing the clock. */
  observedAt?: string
}

/**
 * A stable, short identity for a prompt.
 *
 * Findings are compared across audits: the verifier re-checks one finding by name, and the
 * inbox must not reshuffle between runs. Numbering prompts by position would break both the
 * moment a client adds a prompt, because every finding after it would silently change identity
 * and read as one finding closing and another opening. Hashing the prompt text means a finding's
 * id depends only on the question it is about. djb2, because it needs to be stable and short,
 * not cryptographic.
 */
function promptKey(prompt: string): string {
  let hash = 5381
  for (let i = 0; i < prompt.length; i += 1) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36).padStart(6, '0').slice(0, 6)
}

/** Competitors cited for this prompt anywhere in the window, deduplicated, in a stable order. */
function competitorsIn(checks: readonly CitationCheck[]): string[] {
  return [...new Set(checks.flatMap((check) => check.citedCompetitors))].sort()
}

/** The "cited in k of N over D days" phrase every one of these findings is built around. */
function sample(summary: PromptSummary): string {
  return (
    `cited in ${summary.citedCount} of ${summary.pollsRun} checks ` +
    `across ${summary.daysPolled} days`
  )
}

const falsification = (summary: PromptSummary, expectation: string): string =>
  `Re-poll this prompt at least ${MIN_POLLS} more times across ${MIN_DAYS} more days after the ` +
  `page ships. ${expectation} This finding was wrong if the fresh window shows the same ` +
  `citation rate, in which case the page was not the problem. Note that a single re-poll proves ` +
  `nothing either way: about 45% of citations appear in only one of three checks, which is the ` +
  `reason this finding took ${summary.daysPolled} days to make in the first place.`

export function evaluateVisibility(input: EvaluateVisibilityInput): VisibilityReport {
  const observedAt = input.observedAt ?? new Date().toISOString()
  const findings: Finding[] = []
  const summaries: PromptSummary[] = []

  // Sorted so the report and the findings come out in the same order every run, whatever order
  // the rows arrived in.
  const prompts = [...input.prompts].sort((a, b) => a.prompt.localeCompare(b.prompt))

  for (const window of prompts) {
    const summary = summarisePrompt(window.checks, window.daysPolled)
    summaries.push(summary)

    // No verdict yet. Not a finding, and not a hedge: the sample is too thin to say anything
    // about the site, and saying it anyway is the overclaim this whole axis exists to refuse.
    if (summary.stability === 'insufficient' || summary.stability === 'stable') continue

    const competitors = competitorsIn(window.checks)
    const consensus = consensusRange(window.answers)

    const evidence = {
      kind: 'citation' as const,
      observedAt,
      source: 'serp' as const,
      prompt: window.prompt,
      engines: [...window.engines],
      pollsRun: summary.pollsRun,
      citedCount: summary.citedCount,
      daysPolled: summary.daysPolled,
      matchedSources: [...window.matchedSources],
      citedCompetitors: competitors,
      ...(consensus ? { consensus } : {}),
    }

    const shared = {
      siteId: input.siteId,
      axis: 'ai_visibility' as const,
      // The count is exact: we ran the polls and parsed the answers. What to do about it is a
      // judgement, but that the client was or was not cited is not in doubt.
      confidence: 1,
      evidence,
      // The engines cite URLs, not our pages. Listing a competitor's cited URL here would read
      // as a page of the client's needing work, which is the opposite of what it is.
      affectedUrls: [],
      estimatedEffort: 'medium' as const,
      fixable: false,
      status: 'open' as const,
    }

    if (summary.stability === 'unstable') {
      findings.push(
        parseFinding({
          ...shared,
          id: `AIV-002#${promptKey(window.prompt)}`,
          ruleId: 'AIV-002',
          severity: 'medium',
          estimatedImpact: 50,
          title: `Cited unstably for "${window.prompt}": ${sample(summary)}`,
          falsification: falsification(
            summary,
            `A working fix raises the citation rate above ${summary.citedCount} of ` +
              `${summary.pollsRun}; an unchanged or lower rate means it failed.`,
          ),
        }),
      )
      continue
    }

    // Stability is 'absent' from here: three or more checks over three or more days, never cited.
    const losing = competitors.length > 0

    findings.push(
      parseFinding({
        ...shared,
        id: `AIV-00${losing ? 1 : 3}#${promptKey(window.prompt)}`,
        ruleId: losing ? 'AIV-001' : 'AIV-003',
        severity: losing ? 'high' : 'low',
        estimatedImpact: losing ? 70 : 35,
        title: losing
          ? `Not cited for "${window.prompt}", while ${competitors.join(', ')} ${
              competitors.length === 1 ? 'is' : 'are'
            }: 0 of ${summary.pollsRun} checks across ${summary.daysPolled} days`
          : `Nobody in your set is cited for "${window.prompt}": ` +
            `0 of ${summary.pollsRun} checks across ${summary.daysPolled} days`,
        falsification: falsification(
          summary,
          losing
            ? `A working fix produces at least one citation where there were none, and a stable ` +
                `one raises it to two of three.`
            : `A working fix produces at least one citation where there were none. This one is ` +
                `speculative in a way the competitive case is not: nobody being cited may mean ` +
                `the engines answer this question without sources at all, in which case no page ` +
                `will win it and the honest outcome is to stop spending on it.`,
        ),
      }),
    )
  }

  return {
    findings,
    summaries,
    share: shareOfVoice(
      prompts.flatMap((window) => window.checks),
      input.target,
    ),
    promptsMeasured: summaries.filter((summary) => summary.stability !== 'insufficient').length,
  }
}
