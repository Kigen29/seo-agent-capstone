import {
  asOwner,
  createDb,
  sites,
  tenants,
  visibilityChecks,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { measureVisibility } from '../src/visibility.js'

/**
 * The AI-visibility axis, read out of a real poll window in a real Postgres.
 *
 * The judgement itself is unit tested against fixtures in @seo/connectors, with no database in
 * sight. What can only be tested here is the part that is about accumulated rows: that a day is
 * a day rather than a check, that a thin window produces silence rather than a verdict, and that
 * the axis says which of the several kinds of nothing it is looking at. Those are the claims the
 * whole axis rests on, and every one of them is a claim about what is in the table.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

const DOMAIN = 'https://heartbeestsafaris.example'
const PROMPT = 'best safari company in nairobi'

describe.skipIf(!shouldRun)('measureVisibility', () => {
  let db: Database
  let closeDb: () => Promise<void>
  let tenantId: string
  let siteId: string

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    closeDb = () => created.pool.end()

    tenantId = await asOwner(db, async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ name: `visibility-test-${Date.now()}` })
        .returning()
      return row!.id
    })

    siteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ tenantId, url: DOMAIN, competitors: ['rivalsafaris.example'] })
        .returning()
      return row!.id
    })
  })

  afterEach(async () => {
    // Prompts cascade to their checks, so one delete clears the window between tests.
    await withTenant(db, tenantId, (tx) =>
      tx.delete(visibilityPrompts).where(eq(visibilityPrompts.siteId, siteId)),
    )
  })

  afterAll(async () => {
    if (!db) return
    await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    await closeDb()
  })

  /** Add a prompt and its checks. `days` are `YYYY-MM-DD`, one check per day per engine. */
  async function seed(
    prompt: string,
    checks: {
      day: string
      engine?: string
      cited: boolean
      competitors?: string[]
      answer?: string
    }[],
  ): Promise<void> {
    await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(visibilityPrompts)
        .values({ tenantId, siteId, prompt })
        .returning({ id: visibilityPrompts.id })

      if (checks.length === 0) return

      await tx.insert(visibilityChecks).values(
        checks.map((check) => ({
          tenantId,
          siteId,
          promptId: row!.id,
          engine: check.engine ?? 'openai',
          cited: check.cited,
          basis: 'citations' as const,
          citedCompetitors: check.competitors ?? [],
          sources: check.cited ? [`${DOMAIN}/safaris`] : [],
          answer: check.answer ?? '',
          polledOn: check.day,
        })),
      )
    })
  }

  /**
   * A fixed "today" for every test in this file.
   *
   * The seeded days below are absolute dates, and the window they are read through is computed
   * backwards from the current time (`VISIBILITY_WINDOW_DAYS`). Left to the real clock, these
   * tests pass while the dates are fresh and then rot, which is exactly what happened: written
   * on 1 August against days in late July, they aged out of the fourteen-day window around 13
   * August. One then failed loudly, and the other kept passing for the wrong reason, because
   * "no checks in the window" and "too few checks in the window" both produce `measured: false`.
   * A green test asserting nothing is the worse of the two outcomes.
   *
   * Pinning `now` is the fix rather than making the seeded days relative, because these tests
   * are about specific windows and boundaries, and a date arithmetic helper in the fixture would
   * reimplement the very calculation under test.
   */
  const NOW = new Date('2026-08-01T12:00:00Z')

  const measure = () =>
    measureVisibility(
      db,
      {
        tenantId,
        siteId,
        domain: DOMAIN,
        competitors: ['rivalsafaris.example'],
      },
      NOW,
    )

  it('says which kind of nothing it is looking at when no prompts are configured', async () => {
    const result = await measure()

    expect(result.measured).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.note).toMatch(/no prompts configured/i)
  })

  it('distinguishes a configured-but-unpolled site from an unconfigured one', async () => {
    await seed(PROMPT, [])
    const result = await measure()

    expect(result.measured).toBe(false)
    expect(result.note).toMatch(/waiting for their first poll/i)
  })

  it('reports no verdict while the window is still filling', async () => {
    await seed(PROMPT, [
      { day: '2026-07-30', cited: false, competitors: ['rivalsafaris.example'] },
      { day: '2026-07-31', cited: false, competitors: ['rivalsafaris.example'] },
    ])

    const result = await measure()

    expect(result.measured).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.note).toMatch(/no verdict yet/i)
  })

  it('counts days, not checks: three engines in one day is still one day', async () => {
    await seed(PROMPT, [
      { day: '2026-07-31', engine: 'openai', cited: false, competitors: ['rivalsafaris.example'] },
      { day: '2026-07-31', engine: 'google', cited: false, competitors: ['rivalsafaris.example'] },
      { day: '2026-07-31', engine: 'groq', cited: false, competitors: ['rivalsafaris.example'] },
    ])

    const result = await measure()

    // Three checks clears the sample floor. One day does not clear the time floor, and a
    // citation verdict from a single moment is exactly what this axis refuses to produce.
    expect(result.measured).toBe(false)
    expect(result.findings).toEqual([])
  })

  it('raises the competitive loss once the window is real, with the sample on the evidence', async () => {
    await seed(PROMPT, [
      {
        day: '2026-07-30',
        cited: false,
        competitors: ['rivalsafaris.example'],
        answer: 'A mid-range safari runs $2,000 to $4,000 per person.',
      },
      {
        day: '2026-07-31',
        cited: false,
        competitors: ['rivalsafaris.example'],
        answer: 'Budget on roughly $2,500 to $5,000.',
      },
      { day: '2026-08-01', cited: false, answer: 'Most operators quote $3,000 to $6,000.' },
    ])

    const result = await measureVisibility(
      db,
      { tenantId, siteId, domain: DOMAIN, competitors: ['rivalsafaris.example'] },
      NOW,
    )

    expect(result.measured).toBe(true)
    expect(result.promptsMeasured).toBe(1)
    expect(result.findings).toHaveLength(1)

    const finding = result.findings[0]!
    expect(finding.ruleId).toBe('AIV-001')
    expect(finding.axis).toBe('ai_visibility')
    expect(finding.evidence).toMatchObject({
      kind: 'citation',
      pollsRun: 3,
      citedCount: 0,
      daysPolled: 3,
      citedCompetitors: ['rivalsafaris.example'],
      // Parsed out of the stored answers, so the client can state the range the engines already
      // agree on rather than guess at it.
      consensus: { currency: 'USD', low: 2500, high: 5000, answers: 3 },
    })
    expect(result.note).toMatch(/share of voice/i)
  })

  it('reports a stable citation as a clean axis with nothing to fix', async () => {
    await seed(PROMPT, [
      { day: '2026-07-30', cited: true },
      { day: '2026-07-31', cited: true },
      { day: '2026-08-01', cited: false },
    ])

    const result = await measureVisibility(
      db,
      { tenantId, siteId, domain: DOMAIN, competitors: ['rivalsafaris.example'] },
      NOW,
    )

    expect(result.measured).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.note).toMatch(/cited in 2 of 3 checks/i)
  })

  it('refuses a second check for the same prompt, engine and day', async () => {
    await seed(PROMPT, [{ day: '2026-07-31', cited: true }])

    const [prompt] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ id: visibilityPrompts.id })
        .from(visibilityPrompts)
        .where(eq(visibilityPrompts.siteId, siteId)),
    )

    // The guarantee is in the database, not in the worker behaving. A retried job re-running
    // the same day's poll must not be able to inflate the sample.
    const duplicate = withTenant(db, tenantId, (tx) =>
      tx.insert(visibilityChecks).values({
        tenantId,
        siteId,
        promptId: prompt!.id,
        engine: 'openai',
        cited: true,
        basis: 'citations' as const,
        polledOn: '2026-07-31',
      }),
    )

    await expect(duplicate).rejects.toThrow()
  })
})
