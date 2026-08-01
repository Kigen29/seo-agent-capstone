import { checkCitation } from './citation.js'
import type { AiEngine, CitationCheck, EngineAnswer, PollTarget } from './types.js'

/** One engine's answer, and the deterministic verdict the parser reached about it. */
export interface PolledAnswer {
  answer: EngineAnswer
  check: CitationCheck
}

/**
 * Ask every engine one prompt, and keep both what they said and what the parser made of it.
 *
 * The engines are injected, so this composes with real adapters in the worker and with fakes in a
 * test, and it knows nothing about HTTP, API keys, or budgets: a paid engine applies its own budget
 * guard inside `ask`, and an engine with no key is simply not in the list. One engine failing does
 * not sink the poll; its result is dropped and the others still count, which matches the honest
 * "unmeasured for this run" posture the rest of the product takes toward a flaky external source.
 *
 * The answer is returned alongside the verdict rather than discarded, because a verdict without
 * the text it came from is unfalsifiable: a caller storing these rows needs to be able to show a
 * human the answer and the sources the parser matched, or "you were cited" is just our word for
 * it. The consensus range is read out of the same stored text later.
 */
export async function pollEnginesDetailed(
  engines: readonly AiEngine[],
  prompt: string,
  target: PollTarget,
): Promise<PolledAnswer[]> {
  const answers = await Promise.allSettled(engines.map((engine) => engine.ask(prompt)))

  const polled: PolledAnswer[] = []
  for (const answer of answers) {
    if (answer.status === 'fulfilled') {
      polled.push({ answer: answer.value, check: checkCitation(answer.value, target) })
    } else {
      console.warn('visibility: an engine poll failed and was dropped:', answer.reason)
    }
  }
  return polled
}

/** Just the verdicts, for a caller that has no use for the answer texts. */
export async function pollEngines(
  engines: readonly AiEngine[],
  prompt: string,
  target: PollTarget,
): Promise<CitationCheck[]> {
  const polled = await pollEnginesDetailed(engines, prompt, target)
  return polled.map((entry) => entry.check)
}
