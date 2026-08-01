import {
  aiOverviewEngine,
  budgeted,
  createSerpApiProvider,
  pollEnginesDetailed,
  type AiEngine,
  type PollTarget,
} from '@seo/connectors'
import { createBudgetGuard, recordSpend } from '@seo/budget'
import {
  asOwner,
  sites,
  visibilityChecks,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import { LlmClient, NoProviderConfiguredError, resolveChain } from '@seo/llm'
import { enqueuePollAi, type PollAiJob, type Queue } from '@seo/queue'
import { and, eq, notExists } from 'drizzle-orm'
import { createWorkerLlm } from './llm.js'

/**
 * The AI-visibility poll: one day's step of a measurement that only means anything over days.
 *
 * The shape of this file is dictated by ADR-0015. A citation is a claim about a distribution, so
 * the unit of work is not "measure this site" but "add today's observation", and every design
 * choice here follows from that: the day comes from the job rather than the clock, the write is
 * an upsert that ignores conflicts, and nothing in here computes a verdict. The verdict is
 * assembled later, by the audit, out of however many days have accumulated.
 */

/** How much of an answer we keep. Enough for the consensus parser, not a transcript archive. */
const MAX_ANSWER_CHARS = 8_000

/**
 * The instruction the engines are polled with.
 *
 * Deliberately bland, and deliberately not asking about the client. We are measuring what a
 * customer would be told, so the prompt has to be the customer's question and nothing else: any
 * nudge towards naming brands, listing sources, or being comprehensive would change the answer we
 * are trying to observe, and we would be measuring our own prompt engineering. The one thing it
 * does ask for is the sources, because an engine that names them lets the parser match domains
 * instead of falling back to a weaker text mention.
 */
const SYSTEM =
  'Answer the question the way you normally would for someone who asked it. ' +
  'If you used sources, list their URLs at the end under a "Sources:" heading.'

/**
 * An answer engine backed by the role-based LLM layer.
 *
 * The engine is named after the provider that actually answered, not after the role, because the
 * name is data about the measurement: "polled openai on Tuesday" is checkable, "polled poll" is
 * not. It is read off the call's own usage record rather than hard-coded, so no vendor is named
 * in this file (ADR-0005) and a chain that falls through to its second target records the model
 * that really answered, which is the truth about that day's observation.
 *
 * A plain chat model returns no source list, so the parser falls back to a text mention and marks
 * the basis as such. That is weaker evidence, honestly labelled, rather than a citation we cannot
 * support.
 */
function llmEngine(llm: LlmClient, tenantId: string): AiEngine {
  return {
    name: 'llm',
    async ask(prompt: string) {
      const result = await llm.text({ role: 'poll', tenantId, prompt, system: SYSTEM })
      return {
        engine: result.usage.provider,
        prompt,
        answer: result.output,
        // A plain completion exposes no structured source list. Rather than scrape URLs out of
        // the prose and dress them up as citations the engine vouched for, we hand back none and
        // let the parser record the weaker `mention` basis for what it is.
        citations: [],
      }
    },
  }
}

/**
 * Google's AI Overview, when a SERP key is configured and only then.
 *
 * The most valuable engine on the axis, and the only one billed per question. It is also the only
 * one that returns a real source list, so its verdicts carry `basis: 'citations'` where a plain
 * chat model can only manage a text mention.
 *
 * Every query goes through the same per-tenant guard as every LLM call, so the two paid
 * dependencies share one cap rather than having one each (ADR-0016, ADR-0017). No key means no
 * engine, which means the axis is measured by whatever else is configured, or honestly unmeasured.
 */
function serpEngine(db: Database, tenantId: string): AiEngine | null {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) return null

  const guard = createBudgetGuard(db)
  const provider = budgeted(
    createSerpApiProvider({
      apiKey,
      // AI answers are heavily geography-dependent, and the research names geographic scope as
      // the strongest predictor of a stable citation, so asking from the wrong country measures
      // somebody else's market.
      ...(process.env.SERP_COUNTRY ? { country: process.env.SERP_COUNTRY } : {}),
    }),
    {
      tenantId,
      checkBudget: guard.checkBudget,
      recordSpend: (id, entry) =>
        recordSpend(db, id, {
          kind: 'serp',
          provider: entry.provider,
          model: entry.model,
          micros: entry.micros,
        }),
      costPerQueryMicros: serpCostMicros(),
    },
  )

  return aiOverviewEngine(provider)
}

/**
 * What one SERP query costs, in micro-dollars.
 *
 * Configuration rather than a table, because the rate is per plan: SerpApi's price per search
 * falls as the plan grows, so any number hard-coded here would be wrong for most operators. The
 * default is the pay-as-you-go rate at the time of writing, which errs high, and erring high is
 * the safe direction for a cost guard.
 */
function serpCostMicros(): number {
  const configured = Number(process.env.SERP_COST_PER_QUERY_USD)
  const usd = Number.isFinite(configured) && configured > 0 ? configured : 0.015
  return Math.round(usd * 1_000_000)
}

/**
 * The engines this worker can poll, or an empty list when none is configured.
 *
 * Empty is a supported state, not a failure. A tenant with no `LLM_POLL` chain and no SERP key
 * gets an AI-visibility axis that says it is unmeasured and why (ADR-0016: paid data is opt-in,
 * and the axis degrades to honest silence rather than spending or erroring).
 */
export function configuredEngines(llm: LlmClient, tenantId: string, db: Database): AiEngine[] {
  const engines: AiEngine[] = []

  try {
    // Resolve the chain up front rather than discovering it is empty inside the first call. The
    // difference matters: unconfigured is a state to report calmly once, but if it surfaced as a
    // failed call it would be logged as an error per prompt per day, for every site, forever.
    resolveChain('poll')
    engines.push(llmEngine(llm, tenantId))
  } catch (error) {
    if (!(error instanceof NoProviderConfiguredError)) throw error
  }

  const serp = serpEngine(db, tenantId)
  if (serp) engines.push(serp)

  return engines
}

/** Today, as the `YYYY-MM-DD` UTC day the checks table keys on. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Run one day's poll for one site: ask every prompt once, on every configured engine, and record
 * what came back.
 *
 * Failures are asymmetric on purpose. A prompt that fails is logged and skipped, because losing
 * one question's observation for a day is a small, self-healing hole in a rolling window, and
 * failing the whole job would throw away the prompts that did answer. A job with no engines at
 * all returns quietly: there is nothing to retry towards.
 */
export async function runPollAi(
  db: Database,
  job: PollAiJob,
  deps: { llm?: LlmClient } = {},
): Promise<{ prompts: number; checks: number }> {
  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx
      .select({ url: sites.url, competitors: sites.competitors })
      .from(sites)
      .where(eq(sites.id, job.siteId))
      .limit(1)
    return row
  })

  if (!site) throw new Error(`Site ${job.siteId} not found.`)

  const prompts = await withTenant(db, job.tenantId, (tx) =>
    tx
      .select({ id: visibilityPrompts.id, prompt: visibilityPrompts.prompt })
      .from(visibilityPrompts)
      .where(eq(visibilityPrompts.siteId, job.siteId)),
  )

  if (prompts.length === 0) return { prompts: 0, checks: 0 }

  const engines = configuredEngines(deps.llm ?? createWorkerLlm(db), job.tenantId, db)
  if (engines.length === 0) {
    console.log(
      `worker: no answer engine is configured (LLM_POLL, SERPAPI_API_KEY), so site ` +
        `${job.siteId} has no AI-visibility poll today. The axis reports itself unmeasured ` +
        'rather than guessing.',
    )
    return { prompts: prompts.length, checks: 0 }
  }

  const target: PollTarget = { domain: site.url, competitors: site.competitors }
  let written = 0

  for (const prompt of prompts) {
    let polled
    try {
      polled = await pollEnginesDetailed(engines, prompt.prompt, target)
    } catch (error) {
      console.warn(`worker: poll failed for "${prompt.prompt}", skipping it today:`, error)
      continue
    }

    if (polled.length === 0) continue

    /**
     * Ignore a conflict rather than update on it. The unique index is (prompt, engine, day), so a
     * conflict means this prompt already has today's observation, which happens whenever a job is
     * retried after a partial success. Overwriting would let a retry quietly replace a real
     * measurement with a later one; ignoring keeps the first answer of the day, which is the one
     * the sample was drawn from.
     */
    const inserted = await withTenant(db, job.tenantId, (tx) =>
      tx
        .insert(visibilityChecks)
        .values(
          polled.map(({ answer, check }) => ({
            tenantId: job.tenantId,
            siteId: job.siteId,
            promptId: prompt.id,
            engine: check.engine,
            cited: check.cited,
            basis: check.basis,
            citedCompetitors: check.citedCompetitors,
            sources: answer.citations,
            answer: answer.answer.slice(0, MAX_ANSWER_CHARS),
            polledOn: job.day,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: visibilityChecks.id }),
    )

    written += inserted.length
  }

  return { prompts: prompts.length, checks: written }
}

/**
 * Enqueue a poll for every site that has prompts and has not been polled today.
 *
 * This is the scheduler, and it is a query rather than a cron entry per site. The worker already
 * wakes every fifteen minutes (ADR-0006), so asking "who is missing today's row" on each wake is
 * both the schedule and its own catch-up: a runner that never started, a job that failed all its
 * retries, or a day the whole worker was down all resolve themselves on the next wake, as long as
 * the day is not over. There is nothing to reconcile by hand and no cron state to drift.
 *
 * asOwner because this is a system sweep across tenants, not a request.
 */
export async function enqueueDuePolls(
  db: Database,
  queue: Queue,
  day: string = utcDay(),
): Promise<number> {
  const due = await asOwner(db, (tx) =>
    tx
      .selectDistinct({ siteId: visibilityPrompts.siteId, tenantId: visibilityPrompts.tenantId })
      .from(visibilityPrompts)
      .where(
        notExists(
          tx
            .select({ id: visibilityChecks.id })
            .from(visibilityChecks)
            .where(
              and(
                eq(visibilityChecks.siteId, visibilityPrompts.siteId),
                eq(visibilityChecks.polledOn, day),
              ),
            ),
        ),
      ),
  )

  let enqueued = 0
  const BATCH = 10

  for (let i = 0; i < due.length; i += BATCH) {
    const batch = due.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map((site) =>
        enqueuePollAi(queue, { tenantId: site.tenantId, siteId: site.siteId, day }),
      ),
    )

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        enqueued += 1
      } else {
        console.warn(
          `worker: could not enqueue a poll for site ${batch[index]!.siteId}:`,
          result.reason,
        )
      }
    })
  }

  return enqueued
}
