import { generateText, generateObject, embedMany } from 'ai'
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
  if (!p) return 0 // unknown model, do not guess; log it instead
  return (inTok / 1_000_000) * p.inputPerMTok + (outTok / 1_000_000) * p.outputPerMTok
}

export type SpendRecorder = (tenantId: string, usage: LlmUsage) => Promise<void>
export type BudgetChecker = (tenantId: string) => Promise<{ allowed: boolean; reason?: string }>

export class LlmClient {
  constructor(
    private readonly recordSpend: SpendRecorder,
    private readonly checkBudget: BudgetChecker,
  ) {}

  /** Free-text generation. Falls through the chain on rate limit or quota exhaustion. */
  async text(opts: LlmCallOptions): Promise<LlmResult<string>> {
    const budget = await this.checkBudget(opts.tenantId)
    if (!budget.allowed) throw new Error(`Budget guard: ${budget.reason}`)

    const chain = resolveChain(opts.role)
    const attempts: { target: ModelTarget; error: string }[] = []

    for (const target of chain.targets) {
      try {
        const res = await generateText({
          model: languageModel(target),
          system: opts.system,
          prompt: opts.prompt,
          maxTokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0,
        })

        const usage: LlmUsage = {
          inputTokens: res.usage.promptTokens,
          outputTokens: res.usage.completionTokens,
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(target, res.usage.promptTokens, res.usage.completionTokens),
        }
        await this.recordSpend(opts.tenantId, usage)
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
  async object<T>(
    opts: LlmCallOptions & { schema: z.ZodType<T> },
  ): Promise<LlmResult<T>> {
    const budget = await this.checkBudget(opts.tenantId)
    if (!budget.allowed) throw new Error(`Budget guard: ${budget.reason}`)

    const chain = resolveChain(opts.role)
    const attempts: { target: ModelTarget; error: string }[] = []

    for (const target of chain.targets) {
      try {
        const res = await generateObject({
          model: languageModel(target),
          schema: opts.schema,
          system: opts.system,
          prompt: opts.prompt,
          temperature: opts.temperature ?? 0,
        })

        const usage: LlmUsage = {
          inputTokens: res.usage.promptTokens,
          outputTokens: res.usage.completionTokens,
          provider: target.provider,
          model: target.model,
          estimatedUsd: priceOf(target, res.usage.promptTokens, res.usage.completionTokens),
        }
        await this.recordSpend(opts.tenantId, usage)
        return { output: res.object as T, usage }
      } catch (err) {
        attempts.push({ target, error: String((err as Error).message) })
        if (!isRetriable(err)) throw err
      }
    }

    throw new AllTargetsFailedError(opts.role, attempts)
  }

  async embed(texts: string[], tenantId: string): Promise<number[][]> {
    const budget = await this.checkBudget(tenantId)
    if (!budget.allowed) throw new Error(`Budget guard: ${budget.reason}`)

    const chain = resolveChain('embed')
    const target = chain.targets[0]
    const res = await embedMany({ model: embeddingModel(target), values: texts })
    return res.embeddings
  }
}
