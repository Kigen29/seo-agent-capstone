import { generateText, generateObject, embedMany, asSchema } from 'ai'
import type { z } from 'zod'
import { resolveChain } from './config.js'
import { languageModel, embeddingModel } from './providers.js'
import { AllTargetsFailedError, type LlmUsage, type ModelRole, type ModelTarget } from './types.js'
import { PRICING } from './pricing.js'

export interface LlmCallOptions {
  role: ModelRole
  system?: string
  prompt: string
  /** Per-call cap. The tenant budget guard sits above this. */
  maxTokens?: number
  temperature?: number
  tenantId: string
}

export interface LlmResult<T = string> {
  output: T
  usage: LlmUsage
}

/** Errors that justify falling through to the next target in the chain. */
function isRetriable(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  return (
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('insufficient_quota') ||
    msg.includes('overloaded') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('502')
  )
}

function priceOf(target: ModelTarget, inTok: number, outTok: number): number {
  const key = `${target.provider}:${target.model}`
  const p = PRICING[key]
  if (!p) throw new Error(`No price configured for ${key}; refusing unmetered model call.`)
  return (inTok / 1_000_000) * p.inputPerMTok + (outTok / 1_000_000) * p.outputPerMTok
}

export type SpendRecorder = (tenantId: string, usage: LlmUsage) => Promise<void>
export type BudgetChecker = (
  tenantId: string,
  reserveMicros?: number,
) => Promise<{ allowed: boolean; reason?: string; reservationId?: string }>

class SpendPersistenceError extends Error {
  constructor(cause: unknown) {
    super('Model usage could not be recorded; refusing another provider call.', { cause })
    this.name = 'SpendPersistenceError'
  }
}

export class LlmClient {
  constructor(
    private readonly recordSpend: SpendRecorder,
    private readonly checkBudget: BudgetChecker,
  ) {}

  private async persistUsage(tenantId: string, usage: LlmUsage): Promise<void> {
    try {
      await this.recordSpend(tenantId, usage)
    } catch (error) {
      throw new SpendPersistenceError(error)
    }
  }

  private async reserve(
    target: ModelTarget,
    tenantId: string,
    input: string,
    outputTokens: number,
  ) {
    if (!Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > 32_768) {
      throw new Error('Output token limit must be between 0 and 32768')
    }
    // Conservative text-only estimate: UTF-8 bytes exceed ordinary tokenizer counts;
    // include schema text and a framing allowance. No tools/images are accepted here.
    const inputTokens = Buffer.byteLength(input, 'utf8') * 2 + 8192
    const micros = Math.ceil(priceOf(target, inputTokens, outputTokens) * 1_000_000)
    const verdict = await this.checkBudget(tenantId, micros)
    if (!verdict.allowed) throw new Error(`Budget guard: ${verdict.reason}`)
    return { inputTokens, outputTokens, reservationId: verdict.reservationId }
  }

  /** Free-text generation. Falls through the chain on rate limit or quota exhaustion. */
  async text(opts: LlmCallOptions): Promise<LlmResult<string>> {
    const chain = resolveChain(opts.role)
    const attempts: { target: ModelTarget; error: string }[] = []

    for (const target of chain.targets) {
      const reservation = await this.reserve(
        target,
        opts.tenantId,
        (opts.system ?? '') + opts.prompt,
        opts.maxTokens ?? 4096,
      )
      try {
        const res = await generateText({
          model: languageModel(target),
          system: opts.system,
          prompt: opts.prompt,
          maxOutputTokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0,
          maxRetries: 0,
        })

        const usage: LlmUsage = {
          reservationId: reservation.reservationId,
          inputTokens: res.usage.inputTokens ?? reservation.inputTokens,
          outputTokens: res.usage.outputTokens ?? reservation.outputTokens,
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(
            target,
            res.usage.inputTokens ?? reservation.inputTokens,
            res.usage.outputTokens ?? reservation.outputTokens,
          ),
        }
        await this.persistUsage(opts.tenantId, usage)
        return { output: res.text, usage }
      } catch (err) {
        attempts.push({ target, error: String((err as Error).message) })
        if (!isRetriable(err)) throw err
        // else: fall through to the next target in the chain
      }
    }

    throw new AllTargetsFailedError(opts.role, attempts)
  }

  /** Structured generation. Use this for anything the code will parse. Never parse free text. */
  async object<T>(opts: LlmCallOptions & { schema: z.ZodType<T> }): Promise<LlmResult<T>> {
    const chain = resolveChain(opts.role)
    const attempts: { target: ModelTarget; error: string }[] = []

    for (const target of chain.targets) {
      const reservation = await this.reserve(
        target,
        opts.tenantId,
        (opts.system ?? '') + opts.prompt + JSON.stringify(asSchema(opts.schema).jsonSchema),
        opts.maxTokens ?? 4096,
      )
      try {
        const res = await generateObject({
          model: languageModel(target),
          schema: opts.schema,
          maxOutputTokens: opts.maxTokens ?? 4096,
          system: opts.system,
          prompt: opts.prompt,
          temperature: opts.temperature ?? 0,
          maxRetries: 0,
        })

        const usage: LlmUsage = {
          reservationId: reservation.reservationId,
          inputTokens: res.usage.inputTokens ?? reservation.inputTokens,
          outputTokens: res.usage.outputTokens ?? reservation.outputTokens,
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(
            target,
            res.usage.inputTokens ?? reservation.inputTokens,
            res.usage.outputTokens ?? reservation.outputTokens,
          ),
        }
        await this.persistUsage(opts.tenantId, usage)
        return { output: res.object as T, usage }
      } catch (err) {
        attempts.push({ target, error: String((err as Error).message) })
        if (!isRetriable(err)) throw err
      }
    }

    throw new AllTargetsFailedError(opts.role, attempts)
  }

  async embed(texts: string[], tenantId: string): Promise<number[][]> {
    const chain = resolveChain('embed')
    const attempts: { target: ModelTarget; error: string }[] = []
    for (const target of chain.targets) {
      const reservation = await this.reserve(target, tenantId, texts.join('\n'), 0)
      try {
        const res = await embedMany({
          model: embeddingModel(target),
          values: texts,
          maxRetries: 0,
          maxParallelCalls: 1,
        })
        await this.persistUsage(tenantId, {
          reservationId: reservation.reservationId,
          inputTokens: res.usage.tokens ?? reservation.inputTokens,
          outputTokens: 0,
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(target, res.usage.tokens ?? reservation.inputTokens, 0),
        })
        return res.embeddings
      } catch (error) {
        attempts.push({ target, error: String((error as Error).message) })
        if (!isRetriable(error)) throw error
      }
    }
    throw new AllTargetsFailedError('embed', attempts)
  }
}
