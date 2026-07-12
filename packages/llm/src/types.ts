/**
 * Role-based model addressing.
 *
 * Application code NEVER names a provider or a model. It asks for a ROLE.
 * Which provider and model serve that role is resolved at runtime from env.
 * Adding a new key or swapping a model is a .env change, never a code change.
 */
export type ModelRole = 'fast' | 'smart' | 'embed' | 'judge'

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'openrouter'
  | 'ollama'
  | 'custom' // any OpenAI-compatible endpoint

/** A single resolved target, e.g. { provider: 'openai', model: 'gpt-4.1-mini' } */
export interface ModelTarget {
  provider: ProviderId
  model: string
  /** Only for provider 'custom'. An OpenAI-compatible base URL. */
  baseUrl?: string
}

/**
 * A role resolves to an ordered chain of targets.
 * The first is primary. The rest are fallbacks, tried in order on
 * rate limit, quota exhaustion, or transient failure.
 */
export interface RoleChain {
  role: ModelRole
  targets: ModelTarget[]
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  provider: ProviderId
  model: string
  estimatedUsd: number
}

export class NoProviderConfiguredError extends Error {
  constructor(role: ModelRole) {
    super(
      `No provider is configured for role "${role}". ` +
        `Set LLM_${role.toUpperCase()} in .env, and set the matching API key. ` +
        `Example: LLM_SMART=openai:gpt-4.1 and OPENAI_API_KEY=sk-...`,
    )
    this.name = 'NoProviderConfiguredError'
  }
}

export class AllTargetsFailedError extends Error {
  constructor(role: ModelRole, attempts: { target: ModelTarget; error: string }[]) {
    super(
      `Every target in the chain for role "${role}" failed:\n` +
        attempts.map((a) => `  - ${a.target.provider}:${a.target.model} -> ${a.error}`).join('\n'),
    )
    this.name = 'AllTargetsFailedError'
  }
}
