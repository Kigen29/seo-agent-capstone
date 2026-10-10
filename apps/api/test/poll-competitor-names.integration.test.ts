import { asOwner, createDb, sites, tenants, visibilityChecks, visibilityPrompts } from '@seo/db'
import type { LlmClient } from '@seo/llm'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPollAi } from '../../worker/src/poll.js'

/**
 * The daily poll, end to end, with a competitor that has to be named (ADR-0041).
 *
 * The rule that names a competitor and the rule that finds a name in an answer each had their
 * own tests. What joins them, inside the job that runs once a day on the worker, had none: it
 * typechecked, and the first real poll was going to be the proof. This is that proof, run here
 * against a real Postgres with the two things that cost money or touch the network replaced:
 * the model that answers, and the reader that fetches a competitor's homepage.
 *
 * Kept with the API's tests because the worker has no suite of its own, as `drain-scope` is.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)

const ANSWER =
  'For private trips from Nairobi, Heartbeest Safaris and Mufasa Tours are the usual picks.'

/** An engine that returns words and no source list, which is when names are all there is. */
const model = (answer: string = ANSWER) =>
  ({
    text: vi.fn(async () => ({
      output: answer,
      usage: {
        provider: 'openai',
        model: 'fixture',
        inputTokens: 1,
        outputTokens: 1,
        estimatedUsd: 0,
      },
    })),
  }) as unknown as LlmClient

let tenantId: string
let siteId: string

const checks = () =>
  asOwner(db, (tx) =>
    tx
      .select({
        cited: visibilityChecks.cited,
        basis: visibilityChecks.basis,
        citedCompetitors: visibilityChecks.citedCompetitors,
        polledOn: visibilityChecks.polledOn,
      })
      .from(visibilityChecks)
      .where(eq(visibilityChecks.siteId, siteId))
      .orderBy(visibilityChecks.polledOn),
  )

const storedNames = async () =>
  (
    await asOwner(db, (tx) =>
      tx.select({ names: sites.competitorNames }).from(sites).where(eq(sites.id, siteId)),
    )
  )[0]!.names

beforeAll(async () => {
  tenantId = await asOwner(db, async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: `poll-names-${Date.now()}` })
      .returning()
    return tenant!.id
  })
})

beforeEach(async () => {
  // A chain that resolves, so the model engine is used, and no search engine beside it.
  vi.stubEnv('LLM_POLL', 'openai:fixture')
  vi.stubEnv('OPENAI_API_KEY', 'not-a-real-key')
  vi.stubEnv('SERPAPI_API_KEY', '')

  siteId = await asOwner(db, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        tenantId,
        url: `https://heartbeestsafaris-${Date.now()}.example`,
        brand: 'Heartbeest Safaris',
        competitors: ['mufasatours.com'],
      })
      .returning()
    await tx.insert(visibilityPrompts).values({
      tenantId,
      siteId: site!.id,
      prompt: 'best safari company in nairobi',
    })
    return site!.id
  })
})

afterEach(() => vi.unstubAllEnvs())

afterAll(async () => {
  await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await pool.end()
})

describe('the daily poll names a competitor before it judges an answer', () => {
  it('counts a competitor the answer names, having read its name from its homepage', async () => {
    const readHomepage = vi.fn(async () => ({ title: 'Mufasa Tours | Safaris from Nairobi' }))

    const result = await runPollAi(
      db,
      { tenantId, siteId, day: '2026-10-10' },
      { llm: model(), readHomepage },
    )

    expect(result).toEqual({ prompts: 1, checks: 1 })
    expect(await checks()).toEqual([
      {
        cited: true,
        basis: 'mention',
        // By web address alone this was empty, and the client took the whole answer.
        citedCompetitors: ['mufasatours.com'],
        polledOn: '2026-10-10',
      },
    ])
    expect(readHomepage).toHaveBeenCalledWith('https://mufasatours.com')
    expect(await storedNames()).toEqual({ 'mufasatours.com': 'Mufasa Tours' })
  })

  it('reads the homepage once, and not again the next day', async () => {
    const readHomepage = vi.fn(async () => ({ title: 'Mufasa Tours | Safaris from Nairobi' }))
    const deps = { llm: model(), readHomepage }

    await runPollAi(db, { tenantId, siteId, day: '2026-10-10' }, deps)
    await runPollAi(db, { tenantId, siteId, day: '2026-10-11' }, deps)

    expect(readHomepage).toHaveBeenCalledTimes(1)
    expect((await checks()).map((check) => check.citedCompetitors)).toEqual([
      ['mufasatours.com'],
      ['mufasatours.com'],
    ])
  })

  it('still polls when the homepage cannot be read, and tries again the next day', async () => {
    const readHomepage = vi
      .fn<() => Promise<{ title: string } | null>>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ title: 'Mufasa Tours | Safaris from Nairobi' })
    const deps = { llm: model(), readHomepage }

    const first = await runPollAi(db, { tenantId, siteId, day: '2026-10-10' }, deps)

    // The poll is what was asked for. Failing to name a competitor must not cost it.
    expect(first.checks).toBe(1)
    expect((await checks())[0]!.cited).toBe(true)
    expect((await checks())[0]!.citedCompetitors).toEqual([])
    expect(await storedNames()).toEqual({})

    await runPollAi(db, { tenantId, siteId, day: '2026-10-11' }, deps)

    expect(readHomepage).toHaveBeenCalledTimes(2)
    expect((await checks())[1]!.citedCompetitors).toEqual(['mufasatours.com'])
  })

  it('does not overwrite a name a person typed', async () => {
    await asOwner(db, (tx) =>
      tx
        .update(sites)
        .set({ competitorNames: { 'mufasatours.com': 'Mufasa Travel Company' } })
        .where(eq(sites.id, siteId)),
    )
    const readHomepage = vi.fn(async () => ({ title: 'Mufasa Tours | Safaris from Nairobi' }))

    await runPollAi(
      db,
      { tenantId, siteId, day: '2026-10-10' },
      { llm: model('Most people book with Mufasa Travel Company.'), readHomepage },
    )

    expect(readHomepage).not.toHaveBeenCalled()
    expect(await storedNames()).toEqual({ 'mufasatours.com': 'Mufasa Travel Company' })
    expect((await checks())[0]!.citedCompetitors).toEqual(['mufasatours.com'])
  })

  it('does not count a business with a similar name as the client', async () => {
    const readHomepage = vi.fn(async () => ({ title: 'Mufasa Tours | Safaris from Nairobi' }))

    await runPollAi(
      db,
      { tenantId, siteId, day: '2026-10-10' },
      {
        llm: model('African Hartebeest Safaris Limited runs northern circuit tours.'),
        readHomepage,
      },
    )

    expect((await checks())[0]!.cited).toBe(false)
  })
})
