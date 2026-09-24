import { asOwner, createDb, tenants, withTenant, type Database } from '@seo/db'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordSpend, reserveSpend } from '../src/index.js'

const url = process.env.DATABASE_URL
describe.skipIf(!url)('atomic spending reservations', () => {
  let db: Database
  let close: () => Promise<void>
  const ids: string[] = []
  async function tenant(cap: number) {
    const [row] = await asOwner(db, (tx) =>
      tx
        .insert(tenants)
        .values({ name: 'reservation fixture', monthlyBudgetMicros: cap })
        .returning(),
    )
    ids.push(row!.id)
    return row!.id
  }
  beforeAll(() => {
    const created = createDb(url)
    db = created.db
    close = () => created.pool.end()
  })
  afterAll(async () => {
    for (const id of ids) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, id)))
    await close()
  })
  it('admits only one of simultaneous requests that exceed the tenant cap together', async () => {
    const id = await tenant(100)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => reserveSpend(db, id, 60, 1_000_000_000)),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(1)
  })
  it('counts reservations across tenants against the global cap', async () => {
    const a = await tenant(1_000_000_000),
      b = await tenant(1_000_000_000)
    const result = await asOwner(db, (tx) =>
      tx.execute<{ used: string }>(sql`
      select (select coalesce(sum(micros),0) from spend where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') +
      (select coalesce(sum(reserved_micros),0) from spend_reservations where settled_at is null) as used`),
    )
    const cap = Number(result.rows[0]!.used) + 100
    const results = await Promise.all([reserveSpend(db, a, 60, cap), reserveSpend(db, b, 60, cap)])
    expect(results.filter((r) => r.allowed)).toHaveLength(1)
  })
  it('settles once, releases unused capacity, and rejects another tenant', async () => {
    const id = await tenant(100),
      other = await tenant(100)
    const reservation = await reserveSpend(db, id, 100, 1_000_000_000)
    const entry = {
      reservationId: reservation.reservationId!,
      kind: 'serp',
      provider: 'fixture',
      model: 'search',
      micros: 40,
    }
    await expect(recordSpend(db, other, entry)).rejects.toThrow('does not belong')
    await Promise.all([recordSpend(db, id, entry), recordSpend(db, id, entry)])
    expect((await reserveSpend(db, id, 60, 1_000_000_000)).allowed).toBe(true)
    expect((await reserveSpend(db, id, 1, 1_000_000_000)).allowed).toBe(false)
    await expect(recordSpend(db, id, { ...entry, micros: 50 })).rejects.toThrow('Conflicting')
    const hidden = await withTenant(db, other, (tx) =>
      tx.execute(sql`select * from spend_reservations where tenant_id = ${id}::uuid`),
    )
    expect(hidden.rows).toHaveLength(0)
  })
  it('retains abandoned reservations even across month boundaries', async () => {
    const id = await tenant(100)
    await reserveSpend(db, id, 100, 1_000_000_000)
    await asOwner(db, (tx) =>
      tx.execute(
        sql`update spend_reservations set created_at=now()-interval '40 days' where tenant_id=${id}::uuid`,
      ),
    )
    expect((await reserveSpend(db, id, 1, 1_000_000_000)).allowed).toBe(false)
  })
  it('refuses malformed amounts and paid calls with no global allowance', async () => {
    const id = await tenant(100)
    expect((await reserveSpend(db, id, 1, 0)).allowed).toBe(false)
    for (const amount of [-1, 0.5, NaN, Infinity])
      await expect(reserveSpend(db, id, amount, 100)).rejects.toThrow('safe integer')
  })
})
