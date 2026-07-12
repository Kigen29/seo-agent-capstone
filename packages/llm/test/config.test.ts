import { describe, it, expect } from 'vitest'
import { parseTarget, resolveChain } from '../src/config.js'
import { NoProviderConfiguredError } from '../src/types.js'

describe('parseTarget', () => {
  it('parses a simple provider:model', () => {
    expect(parseTarget('openai:gpt-4.1')).toEqual({ provider: 'openai', model: 'gpt-4.1' })
  })

  it('parses a custom provider with a base URL', () => {
    expect(parseTarget('custom:my-model@https://host.example.com/v1')).toEqual({
      provider: 'custom',
      model: 'my-model',
      baseUrl: 'https://host.example.com/v1',
    })
  })

  it('rejects a malformed target', () => {
    expect(() => parseTarget('gpt-4.1')).toThrow()
  })
})

describe('resolveChain', () => {
  it('drops targets whose API key is absent, so you can list providers you do not have yet', () => {
    const env = {
      LLM_SMART: 'anthropic:claude-sonnet-5,openai:gpt-4.1,groq:llama-3.3-70b-versatile',
      OPENAI_API_KEY: 'sk-test',
      // no ANTHROPIC_API_KEY, no GROQ_API_KEY
    } as NodeJS.ProcessEnv

    const chain = resolveChain('smart', env)
    expect(chain.targets).toHaveLength(1)
    expect(chain.targets[0]).toEqual({ provider: 'openai', model: 'gpt-4.1' })
  })

  it('preserves fallback order when several keys are present', () => {
    const env = {
      LLM_SMART: 'openai:gpt-4.1,google:gemini-2.5-pro',
      OPENAI_API_KEY: 'sk-test',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g-test',
    } as NodeJS.ProcessEnv

    const chain = resolveChain('smart', env)
    expect(chain.targets.map((t) => t.provider)).toEqual(['openai', 'google'])
  })

  it('throws a helpful error when no key in the chain is present', () => {
    const env = { LLM_SMART: 'anthropic:claude-sonnet-5' } as NodeJS.ProcessEnv
    expect(() => resolveChain('smart', env)).toThrow(NoProviderConfiguredError)
  })
})
