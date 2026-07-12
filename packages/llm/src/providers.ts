import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel, EmbeddingModel } from 'ai'
import type { ModelTarget } from './types.js'

/**
 * The ONLY file in the codebase that knows a provider SDK exists.
 * Everything above this line speaks in roles. Everything below speaks in vendors.
 *
 * Adding a brand new provider means adding one case here. Adding a new KEY or a new
 * MODEL for an existing provider means editing .env and nothing else.
 *
 * Groq, OpenRouter, Ollama, and any custom endpoint are all OpenAI-compatible, so they
 * reuse createOpenAI with a different baseURL. That is why the abstraction is cheap.
 */

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
}

export function languageModel(target: ModelTarget): LanguageModel {
  const { provider, model, baseUrl } = target

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model)

    case 'anthropic':
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model)

    case 'google':
      return createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })(model)

    case 'groq':
      return createOpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: OPENAI_COMPATIBLE_BASE_URLS.groq,
      })(model)

    case 'openrouter':
      return createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: OPENAI_COMPATIBLE_BASE_URLS.openrouter,
      })(model)

    case 'ollama':
      return createOpenAI({
        apiKey: 'ollama', // ignored, but the SDK wants a string
        baseURL: OPENAI_COMPATIBLE_BASE_URLS.ollama,
      })(model)

    case 'custom':
      if (!baseUrl) {
        throw new Error(
          `Provider "custom" requires a base URL. Use "custom:model-name@https://host/v1".`,
        )
      }
      return createOpenAI({
        apiKey: process.env.CUSTOM_LLM_API_KEY ?? 'none',
        baseURL: baseUrl,
      })(model)
  }
}

export function embeddingModel(target: ModelTarget): EmbeddingModel<string> {
  const { provider, model } = target

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).embedding(model)
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      }).textEmbeddingModel(model)
    default:
      throw new Error(
        `Provider "${provider}" does not expose an embedding model in this build. ` +
          `Set LLM_EMBED to an openai: or google: target.`,
      )
  }
}
