import {
  asOwner,
  competitorSnapshots,
  createDb,
  sites,
  tenants,
  visibilityChecks,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { competitorWatchReport } from '../src/competitors/report.js'
import type { CompetitorSnapshot } from '../src/competitors/snapshot.js'
import { watchCompetitors } from '../src/competitors/watch.js'

const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

const RIVAL = 'rival-watch.example.com'
const DAY = 86_400_000

const snapshotOf = (title: string, extraUrl?: string): CompetitorSnapshot => ({
  pages: [{ url: `https://${RIVAL}/`, title, description: 'Tours', h1: 'Welcome' }],
  sitemapUrls: [`https://${RIVAL}/`, ...(extraUrl ? [extraUrl] : [])],
  note: null,
})

/**
 * The sweep and the report against a real Postgres, because the two properties that matter here
 * are both about rows: the storage bound, and that one tenant's watch is invisible to another.
 * The weeks are driven by passing `now`, so the story runs in order with no clock involved.
 */
describe.skipIf(!shouldRun)('competitor watch', () => {
  let db: Database
  let closeDb: () => Promise<void>
  let tenantId: string
  let otherTenantId: string
  let siteId: string

  const week0 = new Date('2026-09-01T06:00:00.000Z')
  const week1 = new Date(week0.getTime() + 7 * DAY + 1)
  const week2 = new Date(week1.getTime() + 7 * DAY + 1)

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    closeDb = () => created.pool.end()

    ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
      const rows = await tx
        .insert(tenants)
        .values([{ name: `watch-test-${Date.now()}` }, { name: `watch-other-${Date.now()}` }])
        .returning()
      return [rows[0]!.id, rows[1]!.id]
    })

    siteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ tenantId, url: 'https://watch-test.example.com', competitors: [RIVAL] })
        .returning()
      return row!.id
    })
  })

  afterAll(async () => {
    if (!db) return
    await asOwner(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantId))
      await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
    })
    await closeDb()
  })

  it('takes a first snapshot and reports no changes, with nothing to compare it to', async () => {
    const result = await watchCompetitors(db, {
      now: week0,
      siteId,
      snapshot: async () => snapshotOf('Rival'),
    })

    expect(result).toEqual({ snapshots: 1, changes: 0 })
  })

  it('does not read a competitor again inside the week', async () => {
    let calls = 0
    const result = await watchCompetitors(db, {
      now: new Date(week0.getTime() + 3 * DAY),
      siteId,
      snapshot: async () => {
        calls += 1
        return snapshotOf('Rival')
      },
    })

    expect(result).toEqual({ snapshots: 0, changes: 0 })
    expect(calls).toBe(0)
  })

  it('records what changed a week later', async () => {
    const result = await watchCompetitors(db, {
      now: week1,
      siteId,
      snapshot: async () => snapshotOf('Rival, now with treks', `https://${RIVAL}/treks`),
    })

    expect(result).toEqual({ snapshots: 1, changes: 2 })
  })

  it('keeps two snapshots per competitor however many weeks pass', async () => {
    await watchCompetitors(db, { now: week2, siteId, snapshot: async () => snapshotOf('Rival') })

    const kept = await withTenant(db, tenantId, (tx) =>
      tx.select().from(competitorSnapshots).where(eq(competitorSnapshots.siteId, siteId)),
    )

    expect(kept).toHaveLength(2)
    expect(kept.map((row) => row.takenAt.getTime()).sort()).toEqual([
      week1.getTime(),
      week2.getTime(),
    ])
  })

  it('reports each batch beside the citations before and after it, as counts', async () => {
    const day = (date: Date) => date.toISOString().slice(0, 10)
    await withTenant(db, tenantId, async (tx) => {
      const [prompt] = await tx
        .insert(visibilityPrompts)
        .values({ tenantId, siteId, prompt: 'who runs treks' })
        .returning()
      const check = (polledOn: string, engine: string, cited: boolean) => ({
        tenantId,
        siteId,
        promptId: prompt!.id,
        engine,
        cited: false,
        basis: 'citations' as const,
        citedCompetitors: cited ? [RIVAL] : [],
        polledOn,
      })
      await tx
        .insert(visibilityChecks)
        .values([
          check(day(new Date(week1.getTime() - 2 * DAY)), 'chatgpt', false),
          check(day(new Date(week1.getTime() - 2 * DAY)), 'perplexity', false),
          check(day(new Date(week1.getTime() + 1 * DAY)), 'chatgpt', true),
          check(day(new Date(week1.getTime() + 1 * DAY)), 'perplexity', false),
        ])
    })

    const report = await competitorWatchReport(db, tenantId, siteId, week2)

    expect(report!.competitors).toEqual([
      { domain: RIVAL, lastSnapshotAt: week2.toISOString(), pagesRead: 1, note: null },
    ])
    // Two sweeps found changes: the title and URL at week 1, and the title reverting at week 2.
    const [reverted, changed] = report!.batches
    expect(reverted!.changes.map((change) => change.kind)).toEqual(['title'])
    expect(changed!.detectedAt).toBe(week1.toISOString())
    expect(changed!.changes.map((change) => change.kind).sort()).toEqual(['new_url', 'title'])
    expect(changed!.citationsBefore).toEqual({ cited: 0, checks: 2 })
    expect(changed!.citationsAfter).toEqual({ cited: 1, checks: 2 })
    expect(changed!.afterComplete).toBe(true)
    // The week-2 batch was detected "now", so its after-window has not finished.
    expect(reverted!.afterComplete).toBe(false)
  })

  it('is invisible to another tenant, and a site that is not theirs is not found', async () => {
    expect(await competitorWatchReport(db, otherTenantId, siteId, week2)).toBeNull()

    const seen = await withTenant(db, otherTenantId, (tx) => tx.select().from(competitorSnapshots))
    expect(seen).toEqual([])
  })
})
