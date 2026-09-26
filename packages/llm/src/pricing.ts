/**
 * USD per million tokens. Used only for spend estimation and the budget guard.
 * Unknown models are refused before invocation. Keep this file boring and easy to edit. It is
 * config, not logic.
 *
 * The rule for every entry: when in doubt, price high. An overestimate makes the cap stop paid
 * work a little early; an underestimate lets it spend money the cap believes it has not spent. So
 * no chat model is ever priced at zero, even one with a free tier: a free tier is a bonus that
 * depends on how the key's project is billed, which this code cannot see (pricing.test.ts
 * enforces this).
 *
 * Verified against each vendor's published pricing on PRICES_VERIFIED_ON. Re-verify before
 * enabling paid work, and whenever a model is added:
 *   OpenAI     https://developers.openai.com/api/docs/pricing
 *   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing
 *   Google     https://ai.google.dev/gemini-api/docs/pricing  (paid tier, prompts up to 200k)
 *   Groq       https://console.groq.com/docs/models           (see the Groq note below)
 */
export const PRICES_VERIFIED_ON = '2026-09-26'

export interface Price {
  inputPerMTok: number
  outputPerMTok: number
}

export const PRICING: Record<string, Price> = {
  // OpenAI, standard tier.
  'openai:gpt-4.1': { inputPerMTok: 2.0, outputPerMTok: 8.0 },
  'openai:gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  'openai:gpt-4.1-nano': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'openai:text-embedding-3-small': { inputPerMTok: 0.02, outputPerMTok: 0 },

  // Anthropic, first-party API.
  'anthropic:claude-sonnet-5': { inputPerMTok: 2.0, outputPerMTok: 10.0 },
  'anthropic:claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'anthropic:claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },

  // Google, paid-tier rates. Priced as paid even though AI Studio has a free tier: a key on a
  // billed project pays these rates, and the budget guard cannot tell which kind of key it holds.
  // gemini-2.0-flash and text-embedding-004 were removed: Google has shut both down, and a chain
  // that still names one now fails loudly here instead of with a provider 404.
  'google:gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  'google:gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },

  // Groq publishes no per-token price for this model ("Contact sales" on its models page). This
  // is a deliberate ceiling, not a quote: set well above what the model has historically cost, so
  // the cap errs towards stopping early. Replace it with the real rate once Groq bills the key.
  'groq:llama-3.3-70b-versatile': { inputPerMTok: 1.0, outputPerMTok: 1.0 },
}
