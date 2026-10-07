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
    // The same condition in other vendors' words. Google's reads "currently experiencing high
    // demand ... Please try again later", with no status code in the text.
    msg.includes('high demand') ||
    msg.includes('try again later') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('502') ||
    // A request one target calls too large may fit the next: limits differ by model and by plan.
    msg.includes('too large') ||
    msg.includes('413') ||
    msg.includes('context length') ||
    msg.includes('context window') ||
    // A model the provider has retired or closed to this account is a dead link in the chain,
    // not a reason to stop: vendors withdraw models without notice, and the next target may be
    // fine. The failure is still reported if every target fails.
    msg.includes('no longer available') ||
    msg.includes('decommissioned') ||
    msg.includes('deprecated') ||
    msg.includes('model not found') ||
    msg.includes('does not exist') ||
    msg.includes('is not found for api version')
  )
}

/**
 * A provider's token count, or our own estimate when it did not send a usable one.
 *
 * Not `??`: a provider that reports no usage can surface as NaN rather than undefined (Google's
 * embedding endpoint does), and NaN passes `??`, prices as NaN, and cannot be recorded as spend.
 * The estimate is the reservation's, which is deliberately high, so a missing count over-charges
 * the budget and never under-charges it.
 */
function counted(reported: number | undefined, estimate: number): number {
  return typeof reported === 'number' && Number.isFinite(reported) ? reported : estimate
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

/**
 * Did the provider turn the request away before doing any work?
 *
 * A 4xx is the provider saying no: the key is out of credit, the request is too large for the
 * plan, the model does not exist, the rate limit is reached. Nothing was generated, so nothing
 * was billed, and that is certain. Everything else is not certain. A timeout, a dropped
 * connection or a 5xx can all happen after the provider started work and may be charged, and a
 * failed write to our own ledger follows a call that definitely was.
 *
 * Only the status the SDK reports is trusted, never a number found in the message text: the
 * message is for people and can say "429" about somebody else's request.
 */
function refusedBeforeBilling(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && status >= 400 && status < 500
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

  /**
   * Give back the money held for a call the provider refused.
   *
   * Every call reserves its worst-case cost first, and a reservation that is never settled is
   * held against the budget for good. That is deliberate for a failure that might have been
   * billed (see `refusedBeforeBilling`). It was also happening for calls that plainly were not,
   * such as a key out of credit, and each model tried in the chain left its own hold. On
   * 7 October 2026 the deployment had 35 unsettled reservations holding 1.70 dollars, about a
   * third of everything counted against its allowance, when paid features began reporting the
   * allowance as used up.
   *
   * Settled at zero, which records the refused attempt in the ledger and frees the hold. If the
   * release itself fails the hold simply stays, which is the safe direction, and the original
   * error is the one worth reporting.
   */
  private async releaseIfRefused(
    error: unknown,
    tenantId: string,
    target: ModelTarget,
    reservationId: string | undefined,
  ): Promise<void> {
    if (!reservationId || !refusedBeforeBilling(error)) return
    try {
      await this.recordSpend(tenantId, {
        reservationId,
        inputTokens: 0,
        outputTokens: 0,
        provider: target.provider,
        model: target.model,
        estimatedUsd: 0,
      })
    } catch {
      // Left held. An operator can still settle it; nothing is lost by waiting.
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
          inputTokens: counted(res.usage.inputTokens, reservation.inputTokens),
          outputTokens: counted(res.usage.outputTokens, reservation.outputTokens),
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(
            target,
            counted(res.usage.inputTokens, reservation.inputTokens),
            counted(res.usage.outputTokens, reservation.outputTokens),
          ),
        }
        await this.persistUsage(opts.tenantId, usage)
        return { output: res.text, usage }
      } catch (err) {
        await this.releaseIfRefused(err, opts.tenantId, target, reservation.reservationId)
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
          inputTokens: counted(res.usage.inputTokens, reservation.inputTokens),
          outputTokens: counted(res.usage.outputTokens, reservation.outputTokens),
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(
            target,
            counted(res.usage.inputTokens, reservation.inputTokens),
            counted(res.usage.outputTokens, reservation.outputTokens),
          ),
        }
        await this.persistUsage(opts.tenantId, usage)
        return { output: res.object as T, usage }
      } catch (err) {
        await this.releaseIfRefused(err, opts.tenantId, target, reservation.reservationId)
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
          inputTokens: counted(res.usage.tokens, reservation.inputTokens),
          outputTokens: 0,
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(target, counted(res.usage.tokens, reservation.inputTokens), 0),
        })
        return res.embeddings
      } catch (error) {
        await this.releaseIfRefused(error, tenantId, target, reservation.reservationId)
        attempts.push({ target, error: String((error as Error).message) })
        if (!isRetriable(error)) throw error
      }
    }
    throw new AllTargetsFailedError('embed', attempts)
  }
}
