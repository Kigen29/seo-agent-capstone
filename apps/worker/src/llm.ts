import { LlmClient } from '@seo/llm'

/**
 * The worker's LLM client.
 *
 * The provider and model come entirely from the environment (ADR-0005): the chain is read from
 * `LLM_SMART` and friends, and a target whose API key is absent is dropped, so a worker with no
 * keys configured simply has no chain and every call fails closed. That is the graceful path the
 * content fixer relies on: no keys means the finding stays open, never a broken PR.
 *
 * Spend and per-tenant budgets are a later story. For now spend is logged (so a bill is never a
 * silent surprise) and the budget guard allows every call. When budgets land, this is the one
 * place that changes; nothing that calls `llm.object` has to know.
 */
export function createWorkerLlm(): LlmClient {
  return new LlmClient(
    async (tenantId, usage) => {
      console.log(
        `worker: llm spend for tenant ${tenantId}: ~$${usage.estimatedUsd.toFixed(4)} ` +
          `(${usage.provider}:${usage.model}, ${usage.inputTokens}+${usage.outputTokens} tok)`,
      )
    },
    async () => ({ allowed: true }),
  )
}
