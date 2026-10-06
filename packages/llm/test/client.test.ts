import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
const mock = vi.hoisted(() => ({ embed: vi.fn(), object: vi.fn(), text: vi.fn(), chain: vi.fn() }))
vi.mock('ai', () => ({
  asSchema: () => ({ jsonSchema: {} }),
  embedMany: mock.embed,
  generateObject: mock.object,
  generateText: mock.text,
}))
vi.mock('../src/config.js', () => ({ resolveChain: mock.chain }))
vi.mock('../src/providers.js', () => ({
  embeddingModel: (target: unknown) => target,
  embeddingOptions: (target: { provider: string }) =>
    target.provider === 'google' ? { google: { taskType: 'CLUSTERING' } } : {},
  languageModel: (target: unknown) => target,
}))
import { LlmClient } from '../src/client.js'
beforeEach(() => vi.resetAllMocks())
describe('metered model calls', () => {
  it('records embedding tokens and falls back after a transient failure', async () => {
    mock.chain.mockReturnValue({
      targets: [
        { provider: 'openai', model: 'text-embedding-3-small' },
        { provider: 'openai', model: 'text-embedding-3-small' },
      ],
    })
    mock.embed
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ embeddings: [[1, 2]], usage: { tokens: 17 } })
    const record = vi.fn()
    expect(
      await new LlmClient(record, async () => ({ allowed: true })).embed(['hello'], 'tenant'),
    ).toEqual([[1, 2]])
    expect(record).toHaveBeenCalledWith(
      'tenant',
      expect.objectContaining({ inputTokens: 17, provider: 'openai' }),
    )
    // The first target failed with a 429, so the second one served the call.
    expect(mock.embed).toHaveBeenCalledTimes(2)
  })
  it('records the estimate when a provider reports no usable token count', async () => {
    mock.chain.mockReturnValue({
      targets: [{ provider: 'google', model: 'gemini-embedding-001' }],
    })
    // What Google's embedding endpoint actually returns through the SDK: not undefined, NaN.
    mock.embed.mockResolvedValueOnce({ embeddings: [[1, 2]], usage: { tokens: Number.NaN } })
    const record = vi.fn()

    await new LlmClient(record, async () => ({ allowed: true })).embed(['hello'], 'tenant')

    const usage = record.mock.calls[0]![1] as { inputTokens: number; estimatedUsd: number }
    expect(Number.isFinite(usage.inputTokens)).toBe(true)
    expect(usage.inputTokens).toBeGreaterThan(0)
    expect(Number.isFinite(usage.estimatedUsd)).toBe(true)
    expect(mock.embed).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { google: { taskType: 'CLUSTERING' } } }),
    )
  })
  it('refuses unknown pricing before invoking a provider', async () => {
    mock.chain.mockReturnValue({ targets: [{ provider: 'openai', model: 'unknown' }] })
    await expect(
      new LlmClient(vi.fn(), async () => ({ allowed: true })).embed(['hello'], 'tenant'),
    ).rejects.toThrow('No price configured')
    expect(mock.embed).not.toHaveBeenCalled()
  })
  it('passes the structured output token limit to the SDK', async () => {
    mock.chain.mockReturnValue({ targets: [{ provider: 'openai', model: 'gpt-4.1-mini' }] })
    mock.object.mockResolvedValue({
      object: { title: 'test' },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    await new LlmClient(vi.fn(), async () => ({ allowed: true })).object({
      role: 'smart',
      tenantId: 'tenant',
      prompt: 'test',
      schema: z.object({ title: z.string() }),
      maxTokens: 123,
    })
    expect(mock.object).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 123 }))
  })
})

describe('paid-call retry boundaries', () => {
  it('does not call a fallback when saving successful usage times out', async () => {
    mock.chain.mockReturnValue({
      targets: [
        { provider: 'openai', model: 'gpt-4.1-mini' },
        { provider: 'openai', model: 'gpt-4.1-mini' },
      ],
    })
    mock.text.mockResolvedValue({ text: 'done', usage: { inputTokens: 10, outputTokens: 5 } })
    const record = vi.fn().mockRejectedValue(new Error('database timeout'))
    await expect(
      new LlmClient(record, async () => ({ allowed: true })).text({
        role: 'smart',
        tenantId: 'tenant',
        prompt: 'test',
      }),
    ).rejects.toThrow('usage could not be recorded')
    expect(mock.text).toHaveBeenCalledTimes(1)
    expect(mock.text).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })
})

describe('model spending reservations', () => {
  it('reserves each fallback separately and settles the successful reservation', async () => {
    mock.chain.mockReturnValue({
      targets: [
        { provider: 'openai', model: 'gpt-4.1-mini' },
        { provider: 'openai', model: 'gpt-4.1-mini' },
      ],
    })
    mock.text.mockRejectedValueOnce(new Error('503 timeout')).mockResolvedValueOnce({
      text: 'done',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    const check = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true, reservationId: 'first' })
      .mockResolvedValueOnce({ allowed: true, reservationId: 'second' })
    const record = vi.fn()
    await new LlmClient(record, check).text({
      role: 'smart',
      tenantId: 'tenant',
      prompt: 'test',
      maxTokens: 10,
    })
    expect(check).toHaveBeenCalledTimes(2)
    expect(check).toHaveBeenCalledWith('tenant', expect.any(Number))
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(
      'tenant',
      expect.objectContaining({ reservationId: 'second' }),
    )
  })
  it('tries the next target when one says the request is too large for it', async () => {
    mock.chain.mockReturnValue({
      targets: [
        { provider: 'openai', model: 'gpt-4.1-mini' },
        { provider: 'openai', model: 'gpt-4.1-mini' },
      ],
    })
    mock.object
      .mockRejectedValueOnce(
        new Error('Request too large for model on tokens per minute (TPM): Limit 8000'),
      )
      .mockResolvedValueOnce({ object: { ok: true }, usage: { inputTokens: 10, outputTokens: 5 } })
    const check = vi.fn().mockResolvedValue({ allowed: true, reservationId: 'r' })

    const result = await new LlmClient(vi.fn(), check).object({
      role: 'smart',
      tenantId: 'tenant',
      prompt: 'test',
      schema: z.object({ ok: z.boolean() }),
    })

    expect(result.output).toEqual({ ok: true })
    expect(mock.object).toHaveBeenCalledTimes(2)
  })
  it('refuses the vendor call when reservation capacity is unavailable', async () => {
    mock.chain.mockReturnValue({ targets: [{ provider: 'openai', model: 'gpt-4.1-mini' }] })
    await expect(
      new LlmClient(vi.fn(), async () => ({ allowed: false, reason: 'global cap' })).text({
        role: 'smart',
        tenantId: 'tenant',
        prompt: 'test',
      }),
    ).rejects.toThrow('global cap')
    expect(mock.text).not.toHaveBeenCalled()
  })
})
