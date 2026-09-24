import { sql } from 'drizzle-orm'
import { asOwner, type Database } from './client.js'

export async function appendJob(
  tx: Database,
  tenantId: string,
  key: string,
  kind: string,
  payload: object,
): Promise<void> {
  await tx.execute(sql`insert into job_outbox (tenant_id, event_key, kind, payload)
    values (${tenantId}, ${key}, ${kind}, ${JSON.stringify(payload)}::jsonb)
    on conflict (event_key) do nothing`)
}

/** Publish with a row lock. Crash after enqueue is safe only with idempotent job handlers. */
export async function publishJobs(
  db: Database,
  deliver: (kind: string, payload: unknown) => Promise<unknown>,
  limit = 20,
): Promise<number> {
  let published = 0
  for (let index = 0; index < limit; index += 1) {
    const found = await asOwner(db, async (tx) => {
      const result = await tx.execute<{ id: string; kind: string; payload: unknown }>(sql`
        select id, kind, payload from job_outbox where published_at is null
        order by created_at for update skip locked limit 1`)
      const event = result.rows[0]
      if (!event) return false
      await deliver(event.kind, event.payload)
      await tx.execute(sql`update job_outbox set published_at = now() where id = ${event.id}`)
      return true
    })
    if (!found) break
    published += 1
  }
  return published
}
