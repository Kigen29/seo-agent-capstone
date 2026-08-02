import { priorityScore } from '@seo/core'
import {
  asOwner,
  audits,
  createDb,
  findings,
  sites,
  tenants,
  withTenant,
  type Database,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listFindings, MAX_PAGE_SIZE } from '../src/queries.js'

/**
 * The paginated, filtered findings inbox, against a real Postgres.
 *
 * Pagination is a claim about SQL: that the database can order by the stored priority score and
 * return a bounded slice. It cannot be tested against a fake, because the whole point of the
 * change is that the ordering moved out of JavaScript and into the query plan.
 *
 * The most important test here is the last one. `priority_score` is denormalised, and a
 * denormalised column that drifts from its formula sorts the backlog wrongly and forever, silently.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

describe.skipIf(!shouldRun)('the findings inbox', () => {
  let db: Database
  let closeDb: () => Promise<void>
  let tenantId: string
  let siteA: string
  let siteB: string

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    closeDb = () => created.pool.end()

    tenantId = await asOwner(db, async (tx) => {
      const [row] = await tx
        .insert(tenants)
        .values({ name: `inbox-${Date.now()}` })
        .returning()
      return row!.id
    })

    await withTenant(db, tenantId, async (tx) => {
      const [a] = await tx
        .insert(sites)
        .values({ tenantId, url: 'https://a.example' })
        .returning({ id: sites.id })
      const [b] = await tx
        .insert(sites)
        .values({ tenantId, url: 'https://b.example' })
        .returning({ id: sites.id })
      siteA = a!.id
      siteB = b!.id

      /**
       * Two audits for site A. Only the newer one's findings should ever appear: "current" means
       * the latest audit per site, so re-running replaces a site's findings rather than stacking
       * a second copy beside the first.
       */
      const [oldAudit] = await tx
        .insert(audits)
        .values({
          tenantId,
          siteId: siteA,
          status: 'complete',
          startedAt: new Date('2026-07-01T00:00:00Z'),
        })
        .returning({ id: audits.id })

      const [newAudit] = await tx
        .insert(audits)
        .values({
          tenantId,
          siteId: siteA,
          status: 'complete',
          startedAt: new Date('2026-08-01T00:00:00Z'),
        })
        .returning({ id: audits.id })

      const [auditB] = await tx
        .insert(audits)
        .values({ tenantId, siteId: siteB, status: 'complete' })
        .returning({ id: audits.id })

      /**
       * The score is derived *after* the overrides are merged, not before.
       *
       * Written the other way round first, and the drift test below caught it immediately: rows
       * that overrode `severity` kept the default's score, so a high-severity finding was stored
       * with a medium-severity priority. That is precisely the failure mode denormalising this
       * column introduces, reproduced by accident in a fixture, which is a fair demonstration that
       * the guard is worth having.
       */
      const row = (
        auditId: string,
        siteId: string,
        key: string,
        over: Partial<typeof findings.$inferInsert> = {},
      ) => {
        const base = {
          tenantId,
          siteId,
          auditId,
          key,
          ruleId: 'TECH-001',
          axis: 'crawl_health' as const,
          severity: 'medium' as const,
          confidence: 1,
          title: `Finding ${key}`,
          evidence: {
            kind: 'metric' as const,
            observedAt: new Date().toISOString(),
            source: 'crawler' as const,
            metric: 'x',
            value: 1,
            unit: 'count' as const,
          },
          affectedUrls: ['https://a.example/one', 'https://a.example/two'],
          estimatedEffort: 'small' as const,
          estimatedImpact: 50,
          falsification: 'Re-run it.',
          fixable: false,
          status: 'open' as const,
          ...over,
        }

        return { ...base, priorityScore: priorityScore(base) }
      }

      await tx.insert(findings).values([
        // Superseded: belongs to site A's older audit.
        row(oldAudit!.id, siteA, 'OLD-1', { title: 'Stale finding from a previous audit' }),

        row(newAudit!.id, siteA, 'A-1', {
          title: 'Blocked AI crawler',
          severity: 'critical',
          estimatedEffort: 'trivial',
          estimatedImpact: 95,
          fixable: true,
        }),
        row(newAudit!.id, siteA, 'A-2', {
          title: 'Missing meta description',
          axis: 'content',
          severity: 'low',
          status: 'pr_open',
        }),
        row(newAudit!.id, siteA, 'A-3', { title: 'Thin content page', axis: 'content' }),
        row(auditB!.id, siteB, 'B-1', { title: 'Sitemap is unreachable', severity: 'high' }),
      ])
    })
  })

  afterAll(async () => {
    if (!db) return
    await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    await closeDb()
  })

  it('returns only the latest audit per site', async () => {
    const result = await listFindings(db, tenantId)

    expect(result.total).toBe(4)
    expect(result.findings.map((f) => f.title)).not.toContain('Stale finding from a previous audit')
  })

  it('orders by the stored priority score, highest first', async () => {
    const result = await listFindings(db, tenantId)

    // The critical trivial-effort one outranks everything, which is the whole product.
    expect(result.findings[0]?.title).toBe('Blocked AI crawler')
  })

  it('bounds a page and reports the true total', async () => {
    const first = await listFindings(db, tenantId, { pageSize: 2, page: 1 })
    const second = await listFindings(db, tenantId, { pageSize: 2, page: 2 })

    expect(first.findings).toHaveLength(2)
    expect(second.findings).toHaveLength(2)
    expect(first.total).toBe(4)

    // No row may appear on two pages. Without a deterministic tie-break, equal scores can be
    // returned in either order and rows silently duplicate or vanish between pages.
    const ids = [...first.findings, ...second.findings].map((f) => f.rowId)
    expect(new Set(ids).size).toBe(4)
  })

  it('refuses a page size that would restore the unpaginated behaviour', async () => {
    const result = await listFindings(db, tenantId, { pageSize: 100_000 })
    expect(result.pageSize).toBe(MAX_PAGE_SIZE)
  })

  it.each([
    ['site', { siteId: () => siteB }, 1],
    ['axis', { axis: 'content' as const }, 2],
    ['severity', { severity: 'critical' as const }, 1],
    ['status', { status: 'pr_open' as const }, 1],
    ['fixable', { fixable: true }, 1],
  ])('filters by %s', async (_name, filter, expected) => {
    const resolved = Object.fromEntries(
      Object.entries(filter).map(([k, v]) => [k, typeof v === 'function' ? v() : v]),
    )
    const result = await listFindings(db, tenantId, resolved)
    expect(result.total).toBe(expected)
  })

  it('searches the title and the rule id', async () => {
    expect((await listFindings(db, tenantId, { q: 'sitemap' })).total).toBe(1)
    expect((await listFindings(db, tenantId, { q: 'TECH-001' })).total).toBe(4)
  })

  it('treats a percent sign in the search as a literal, not a wildcard', async () => {
    // Unescaped, `%` in a LIKE pattern matches everything, so a user searching for "100%" would
    // get their whole backlog back and reasonably conclude the search was broken.
    expect((await listFindings(db, tenantId, { q: '%' })).total).toBe(0)
  })

  it('does not ship the affected URLs, only how many there are', async () => {
    const result = await listFindings(db, tenantId)
    const finding = result.findings[0]!

    expect(finding.affectedUrlCount).toBe(2)
    expect(finding).not.toHaveProperty('affectedUrls')
  })

  it('keeps the stored score equal to the formula the UI sorts by', async () => {
    /**
     * The guard on denormalisation. `priority_score` is written at insert time and read back by
     * an indexed ORDER BY, so if it ever diverges from `priorityScore()` the backlog is ordered
     * wrongly, permanently, and nothing else in the system would notice.
     */
    const rows = await withTenant(db, tenantId, (tx) =>
      tx
        .select({
          stored: findings.priorityScore,
          severity: findings.severity,
          confidence: findings.confidence,
          estimatedImpact: findings.estimatedImpact,
          estimatedEffort: findings.estimatedEffort,
        })
        .from(findings)
        .where(eq(findings.tenantId, tenantId)),
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.stored).toBeCloseTo(priorityScore(row), 4)
    }
  })
})
