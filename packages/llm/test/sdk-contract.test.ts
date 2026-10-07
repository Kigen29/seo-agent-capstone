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

  /**
   * The client gives back the money held for a call when the provider refused it, and it knows a
   * refusal by the status on the error the SDK throws. If a future SDK wrapped that error, or
   * renamed the field, the release would silently stop and holds would pile up again with every
   * test of the client still green, because those use a hand-made error. This uses the real SDK.
   */
  it.each([402, 413, 429])('reports a %i refusal with its status on the error', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'refused', type: 'invalid_request' } }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    const failure = await generateText({
      model: languageModel({
        provider: 'custom',
        model: 'fixture-model',
        baseUrl: 'https://fixture.invalid/v1',
      }),
      prompt: 'fixture request',
      maxOutputTokens: 32,
      maxRetries: 0,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect((failure as { statusCode?: unknown }).statusCode).toBe(status)
  })
})
