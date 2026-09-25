import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { languageModel } from '../src/providers.js'

afterEach(() => vi.unstubAllGlobals())

describe('SDK transport contract', () => {
  it('keeps compatible providers on chat completions and reads token usage', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url: String(url), body: JSON.parse(String(init.body)) })
        return new Response(
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion',
            created: 1,
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'fixture response' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const result = await generateText({
      model: languageModel({
        provider: 'custom',
        model: 'fixture-model',
        baseUrl: 'https://fixture.invalid/v1',
      }),
      prompt: 'fixture request',
      maxOutputTokens: 32,
      maxRetries: 0,
    })
    expect(result.text).toBe('fixture response')
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://fixture.invalid/v1/chat/completions')
    expect(requests[0]?.body).toMatchObject({ max_tokens: 32 })
  })
})
