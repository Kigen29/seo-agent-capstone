import { parseTarget, type ModelTarget } from '@seo/llm'

/**
 * Is the judge independent of the thing it grades?
 *
 * A model asked to score its own family's output rates it higher than a neutral grader does. The
 * effect is well enough established that an eval whose judge shares a family with the model under
 * test is not a weak measurement, it is a measurement pointing the wrong way, and it fails in the
 * flattering direction, which is the direction nobody investigates.
 *
 * `LLM_JUDGE` and `LLM_SMART` are separate variables and already resolve separately, so keeping
 * them apart costs one line of configuration. That is exactly why it needs asserting: a thing this
 * easy to get right is a thing nobody checks, and the whole arrangement can be undone by someone
 * copying one line while setting up a new environment.
 *
 * Family, not model id. `openai:gpt-4.1` grading `openai:gpt-4o` is the same lab, the same
 * pretraining lineage and the same idea of a good sentence; comparing model strings would call
 * that independent.
 */
export interface JudgeIndependence {
  independent: boolean
  judge: ModelTarget[]
  under_test: ModelTarget[]
  /** The families on both sides, so a failure message can say what actually collided. */
  shared: string[]
  reason: string
}

/**
 * The provider is the family, except where one provider fronts several.
 *
 * `custom` is an OpenAI-compatible endpoint that could be anything, including a proxy in front of
 * the very model under test, so it is never treated as independent of anything. Guessing would be
 * the same mistake as assuming independence in the first place.
 */
function familyOf(target: ModelTarget): string {
  if (target.provider === 'custom') return `custom:${target.baseUrl ?? 'unknown'}`
  return target.provider
}

/**
 * Compare the two chains, not just their first entries.
 *
 * A chain is an ordered fallback list, and every target in it can serve a call. Comparing only the
 * heads would call `LLM_SMART=openai:...,google:...` independent of `LLM_JUDGE=google:...`, and
 * then the day OpenAI returns a 429 the evaluation quietly starts grading Google with Google.
 * Independence has to hold for every pair that could actually meet.
 */
export function checkJudgeIndependence(
  judgeChain: string | undefined,
  smartChain: string | undefined,
): JudgeIndependence {
  const judge = targets(judgeChain)
  const under_test = targets(smartChain)

  if (judge.length === 0 || under_test.length === 0) {
    return {
      independent: false,
      judge,
      under_test,
      shared: [],
      reason:
        'LLM_JUDGE and LLM_SMART must both be configured. An unset judge does not mean an ' +
        'unbiased one; it means no evaluation can run.',
    }
  }

  const judgeFamilies = new Set(judge.map(familyOf))
  const shared = [...new Set(under_test.map(familyOf))].filter((f) => judgeFamilies.has(f))

  return {
    independent: shared.length === 0,
    judge,
    under_test,
    shared,
    reason:
      shared.length === 0
        ? `judge (${[...judgeFamilies].join(', ')}) shares no family with the model under test`
        : `${shared.join(', ')} appears in both chains, so at least one call could be graded by ` +
          'its own family. Point LLM_JUDGE at a different provider.',
  }
}

function targets(chain: string | undefined): ModelTarget[] {
  if (!chain) return []
  return chain
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseTarget)
}
