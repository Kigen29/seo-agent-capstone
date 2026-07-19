import { checkCitation } from './citation.js'
import type { AiEngine, CitationCheck, PollTarget } from './types.js'

/**
 * Ask every engine one prompt and return the deterministic citation verdicts.
 *
 * The engines are injected, so this composes with real adapters in the worker and with fakes in a
 * test, and it knows nothing about HTTP, API keys, or budgets: a paid engine applies its own budget
 * guard inside `ask`, and an engine with no key is simply not in the list. One engine failing does
 * not sink the poll; its result is dropped and the others still count, which matches the honest
 * "unmeasured for this run" posture the rest of the product takes toward a flaky external source.
 */
export async function pollEngines(
  engines: readonly AiEngine[],
  prompt: string,
  target: PollTarget,
): Promise<CitationCheck[]> {
  const answers = await Promise.allSettled(engines.map((engine) => engine.ask(prompt)))

  const checks: CitationCheck[] = []
  for (const answer of answers) {
    if (answer.status === 'fulfilled') {
      checks.push(checkCitation(answer.value, target))
    } else {
      console.warn('visibility: an engine poll failed and was dropped:', answer.reason)
    }
  }
  return checks
}
