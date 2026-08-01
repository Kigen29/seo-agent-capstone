import { createBudgetGuard } from '@seo/budget'
import type { Database } from '@seo/db'
import { LlmClient } from '@seo/llm'

/**
 * The worker's LLM client.
 *
 * The provider and model come entirely from the environment (ADR-0005): the chain is read from
 * `LLM_SMART` and friends, and a target whose API key is absent is dropped, so a worker with no
 * keys configured simply has no chain and every call fails closed. That is the graceful path the
 * content fixer relies on: no keys means the finding stays open, never a broken PR.
 *
 * Spend and the per-tenant cap are real now (ADR-0016). Every call checks the tenant's remaining
 * budget before it is made and writes what it cost to the ledger after, so the worst case for a
 * misconfigured tenant is paused paid work rather than an unbounded bill. Nothing that calls
 * `llm.object` had to change: the guard was always an injected dependency, and this is the
 * implementation that finally fills the hole.
 */
export function createWorkerLlm(db: Database): LlmClient {
  const guard = createBudgetGuard(db)

  return new LlmClient(async (tenantId, usage) => {
    console.log(
      `worker: llm spend for tenant ${tenantId}: ~$${usage.estimatedUsd.toFixed(4)} ` +
        `(${usage.provider}:${usage.model}, ${usage.inputTokens}+${usage.outputTokens} tok)`,
    )
    await guard.recordSpend(tenantId, usage)
  }, guard.checkBudget)
}
