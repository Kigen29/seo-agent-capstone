import type { SerpProvider, SerpQueryOptions } from '../serp/types.js'
import type { AiEngine, EngineAnswer } from './types.js'

/**
 * Google's AI Overview, as one more engine the citation poll can ask.
 *
 * The most valuable engine on the axis and the only one that costs money per question. It is also
 * the only one that returns a real source list: a plain chat model answers from weights and can
 * only be matched on a text mention, while an AI Overview names the pages it was built from. That
 * is the difference between `basis: 'citations'` and `basis: 'mention'` in the parser, and it is
 * why this engine's verdicts are the strongest evidence the axis has.
 *
 * It is an adapter over the SerpProvider rather than a second implementation of it, so the poll
 * stays ignorant of both the vendor and the fact that this engine is billed at all. The budget
 * guard is already wrapped around the provider before it reaches here (ADR-0016).
 */
export function aiOverviewEngine(provider: SerpProvider, options: SerpQueryOptions = {}): AiEngine {
  return {
    /**
     * Named for the engine, not the vendor. The name is stored on every check row and is part of
     * the unique key that makes one poll per engine per day, so it has to describe what was
     * measured. Switching from SerpApi to DataForSEO does not change what an AI Overview is, and
     * a rename would fork one measurement window into two.
     */
    name: 'ai_overview',

    async ask(prompt: string): Promise<EngineAnswer> {
      const result = await provider.aiOverview(prompt, options)

      /**
       * No overview for this query is a real answer, not a failure. Google shows one for some
       * questions and not others, and an absent overview means nobody was cited, which is exactly
       * what an empty answer with no sources records. Throwing here would drop the observation
       * entirely and leave a hole in a window that is only three days wide.
       */
      return {
        engine: 'ai_overview',
        prompt,
        answer: result.present ? result.text : '',
        citations: result.present ? result.sources.map((source) => source.url) : [],
      }
    },
  }
}
