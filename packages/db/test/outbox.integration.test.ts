import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asOwner, createDb, withTenant } from '../src/client.js'
import { appendJob, publishJobs } from '../src/outbox.js'
import { tenants } from '../src/schema/tables.js'

describe.skipIf(!process.env.DATABASE_URL && !process.env.CI)('transactional outbox', () => {
  const connection = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:1/seo_test',
  )
  const tenantId = randomUUID()
  beforeAll(async () => {
    await asOwner(connection.db, (tx) =>
      tx.insert(tenants).values({ id: tenantId, name: 'outbox-regression' }),
    )
  })
  beforeEach(async () => {
    await withTenant(connection.db, tenantId, (tx) =>
      tx.execute(sql`delete from job_outbox where tenant_id = ${tenantId}`),
    )
  })
  afterAll(async () => {
    await asOwner(connection.db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    await connection.pool.end()
  })
  it('rolls back with business state and retries a failed publication without losing it', async () => {
    await expect(
      withTenant(connection.db, tenantId, async (tx) => {
        await appendJob(tx, tenantId, `${tenantId}:rollback`, 'audit', { tenantId })
        throw new Error('simulate failed business write')
      }),
    ).rejects.toThrow('simulate failed')
    const rolledBack = await withTenant(connection.db, tenantId, (tx) =>
      tx.execute(sql`select id from job_outbox where tenant_id = ${tenantId}`),
    )
    expect(rolledBack.rows).toHaveLength(0)
    await withTenant(connection.db, tenantId, async (tx) => {
      await appendJob(tx, tenantId, `${tenantId}:publish`, 'audit', { tenantId })
      await appendJob(tx, tenantId, `${tenantId}:publish`, 'audit', { tenantId })
    })
    await publishJobs(connection.db, async () => {
      throw new Error('queue unavailable')
    })
    const deferred = await withTenant(connection.db, tenantId, (tx) =>
      tx.execute<{
        attempt_count: number
        last_failure_code: string
        published_at: string | null
        delayed: boolean
      }>(sql`select attempt_count, last_failure_code, published_at, next_attempt_at > now() as delayed
      from job_outbox where tenant_id = ${tenantId}`),
    )
    expect(deferred.rows[0]).toMatchObject({
      attempt_count: 1,
      last_failure_code: 'delivery_failed',
      published_at: null,
      delayed: true,
    })
    await withTenant(connection.db, tenantId, (tx) =>
      tx.execute(sql`
      update job_outbox set next_attempt_at = now() - interval '1 second' where tenant_id = ${tenantId}`),
    )
    const delivered: unknown[] = []
    await publishJobs(connection.db, async (_kind, payload) => {
      delivered.push(payload)
    })
    expect(delivered).toContainEqual({ tenantId })
    const remaining = await withTenant(connection.db, tenantId, (tx) =>
      tx.execute(
        sql`select id from job_outbox where tenant_id = ${tenantId} and published_at is null`,
      ),
    )
    expect(remaining.rows).toHaveLength(0)
    const other = await withTenant(connection.db, randomUUID(), (tx) =>
      tx.execute(sql`select id from job_outbox where tenant_id = ${tenantId}`),
    )
    expect(other.rows).toHaveLength(0)
  })
  it('delays a broken event without blocking later events or retrying before its due time', async () => {
    await withTenant(connection.db, tenantId, async (tx) => {
      await appendJob(tx, tenantId, `${tenantId}:broken`, 'broken-fixture', { tenantId })
      await appendJob(tx, tenantId, `${tenantId}:healthy`, 'healthy-fixture', { tenantId })
      await tx.execute(
        sql`update job_outbox set next_attempt_at=now()-interval '1 day' where event_key=${`${tenantId}:broken`}`,
      )
    })
    let failures = 0
    const deliver = async (kind: string) => {
      if (kind === 'broken-fixture') {
        failures++
        throw new Error('sensitive payload must not be stored')
      }
    }
    await publishJobs(connection.db, deliver)
    await publishJobs(connection.db, deliver)
    expect(failures).toBe(1)
    const rows = await withTenant(connection.db, tenantId, (tx) =>
      tx.execute<{
        kind: string
        published_at: string | null
        attempt_count: number
        last_failure_code: string | null
      }>(sql`
      select kind,published_at,attempt_count,last_failure_code from job_outbox where tenant_id=${tenantId}`),
    )
    const healthy = rows.rows.find((r) => r.kind === 'healthy-fixture')
    expect(healthy).toBeDefined()
    expect(healthy?.published_at).not.toBeNull()
    expect(Number.isFinite(Date.parse(healthy!.published_at!))).toBe(true)
    expect(rows.rows.find((r) => r.kind === 'broken-fixture')).toMatchObject({
      published_at: null,
      attempt_count: 1,
      last_failure_code: 'delivery_failed',
    })
  })

  it('allows concurrent publishers to deliver a row only once', async () => {
    await withTenant(connection.db, tenantId, (tx) =>
      appendJob(tx, tenantId, `${tenantId}:parallel`, 'parallel-fixture', { tenantId }),
    )
    let count = 0
    await Promise.all(
      Array.from({ length: 4 }, () =>
        publishJobs(connection.db, async (kind) => {
          if (kind === 'parallel-fixture') count++
        }),
      ),
    )
    expect(count).toBe(1)
  })
})
