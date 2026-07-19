/**
 * AI visibility: whether AI answer engines cite the client for the questions their customers ask.
 *
 * The whole axis is built to be honest in the two ways the research says every other tool is not.
 * First, the engine is the thing being *measured*, never the detector: we send it a prompt, it
 * returns an answer and (where it can) the sources it cited, and a deterministic parser decides
 * whether the client was cited. No model is ever asked "were they cited", which would be an LLM
 * grading itself (ADR-0001, on a new axis). Second, a citation is reported only when it is stable
 * across several polls over several days, because roughly 45% of citations appear in only one of
 * three checks, so a single poll is noise.
 */

/** One AI answer engine we can poll. Adapters wrap ChatGPT, Perplexity, or AI Overviews. */
export interface AiEngine {
  /** A stable identifier, e.g. 'chatgpt', 'perplexity', 'ai_overview'. */
  readonly name: string
  /** Ask the engine a question. A paid engine applies its own budget guard before spending. */
  ask(prompt: string): Promise<EngineAnswer>
}

/** What an engine returned for one prompt. */
export interface EngineAnswer {
  engine: string
  prompt: string
  /** The answer text the engine produced. */
  answer: string
  /**
   * The source URLs the engine cited, if it exposes them (Perplexity and AI Overviews do; a plain
   * chat model does not). Empty means the engine cited nothing, or cannot tell us what it cited.
   */
  citations: string[]
}

/** Who we are checking citations for, and against whom. */
export interface PollTarget {
  /** The client's domain or host, e.g. 'heartbeestsafaris.com'. */
  domain: string
  /** Competitor domains, for share of voice. */
  competitors: string[]
}

/** The deterministic verdict for one engine answer: was the client cited, and which rivals were. */
export interface CitationCheck {
  engine: string
  prompt: string
  cited: boolean
  citedCompetitors: string[]
  /**
   * How we decided. `citations` means the engine gave a source list we matched against; `mention`
   * means it gave no sources, so we fell back to the domain appearing in the answer text, which is
   * weaker and recorded as such.
   */
  basis: 'citations' | 'mention'
}
