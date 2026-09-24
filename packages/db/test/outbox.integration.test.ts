import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    await expect(
      publishJobs(connection.db, async () => {
        throw new Error('queue unavailable')
      }),
    ).rejects.toThrow('queue unavailable')
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
})
