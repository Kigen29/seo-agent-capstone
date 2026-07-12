import { z } from 'zod'
import type { ModelRole, ModelTarget, ProviderId, RoleChain } from './types.js'
import { NoProviderConfiguredError } from './types.js'

/**
 * Parses role chains from environment variables.
 *
 * Syntax:
 *   LLM_SMART=openai:gpt-4.1
 *   LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro,groq:llama-3.3-70b-versatile
 *   LLM_FAST=custom:my-model@https://my-endpoint.example.com/v1
 *
 * Comma separated = an ordered fallback chain.
 * The "custom" provider takes an OpenAI-compatible base URL after an @.
 */

const PROVIDERS: readonly ProviderId[] = [
  'openai',
  'anthropic',
  'google',
  'groq',
  'openrouter',
  'ollama',
  'custom',
] as const

const targetSchema = z.object({
  provider: z.enum(PROVIDERS as unknown as [ProviderId, ...ProviderId[]]),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
})

/** Which env var holds the key for each provider. */
export const API_KEY_ENV: Record<ProviderId, string | null> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ollama: null, // local, no key
  custom: 'CUSTOM_LLM_API_KEY',
}

export function parseTarget(raw: string): ModelTarget {
  const trimmed = raw.trim()
  const [providerPart, ...rest] = trimmed.split(':')
  const remainder = rest.join(':') // models may contain colons

  if (!remainder) {
    throw new Error(
      `Malformed model target "${raw}". Expected "provider:model", e.g. "openai:gpt-4.1".`,
    )
  }

  const [model, baseUrl] = remainder.split('@')

  return targetSchema.parse({
    provider: providerPart.trim(),
    model: model.trim(),
    baseUrl: baseUrl?.trim(),
  })
}

const ROLE_ENV: Record<ModelRole, string> = {
  fast: 'LLM_FAST',
  smart: 'LLM_SMART',
  embed: 'LLM_EMBED',
  judge: 'LLM_JUDGE',
}

/**
 * Resolve a role to its chain, dropping any target whose API key is absent.
 * This is what makes "add a key later without touching code" work: you can list
 * five providers in the chain, and only the ones you actually have keys for are used.
 */
export function resolveChain(role: ModelRole, env: NodeJS.ProcessEnv = process.env): RoleChain {
  const raw = env[ROLE_ENV[role]]
  if (!raw) throw new NoProviderConfiguredError(role)

  const all = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseTarget)

  const usable = all.filter((t) => {
    const keyEnv = API_KEY_ENV[t.provider]
    if (keyEnv === null) return true // ollama, no key needed
    return Boolean(env[keyEnv])
  })

  if (usable.length === 0) throw new NoProviderConfiguredError(role)

  return { role, targets: usable }
}
