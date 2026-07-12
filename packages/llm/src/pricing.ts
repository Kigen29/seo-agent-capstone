/**
 * USD per million tokens. Used only for spend estimation and the budget guard.
 * Unknown models return 0 cost and are logged, so add yours here when you add a key.
 * Keep this file boring and easy to edit. It is config, not logic.
 */
export interface Price {
  inputPerMTok: number
  outputPerMTok: number
}

export const PRICING: Record<string, Price> = {
  // OpenAI
  'openai:gpt-4.1': { inputPerMTok: 2.0, outputPerMTok: 8.0 },
  'openai:gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  'openai:gpt-4.1-nano': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'openai:text-embedding-3-small': { inputPerMTok: 0.02, outputPerMTok: 0 },

  // Anthropic
  'anthropic:claude-sonnet-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'anthropic:claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },

  // Free tiers: cost recorded as zero, but still counted in the call ledger
  'google:gemini-2.0-flash': { inputPerMTok: 0, outputPerMTok: 0 },
  'google:gemini-2.5-pro': { inputPerMTok: 0, outputPerMTok: 0 },
  'google:text-embedding-004': { inputPerMTok: 0, outputPerMTok: 0 },
  'groq:llama-3.3-70b-versatile': { inputPerMTok: 0, outputPerMTok: 0 },
}
