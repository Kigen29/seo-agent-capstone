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
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000) {
    throw new Error('Outbox publication limit must be an integer between 0 and 1000')
  }
  let published = 0
  for (let index = 0; index < limit; index += 1) {
    const found = await asOwner(db, async (tx) => {
      const result = await tx.execute<{
        id: string
        kind: string
        payload: unknown
        attempt_count: number
      }>(sql`
        select id, kind, payload, attempt_count from job_outbox
        where published_at is null and next_attempt_at <= now()
        order by next_attempt_at, created_at, id for update skip locked limit 1`)
      const event = result.rows[0]
      if (!event) return 'empty'
      try {
        await deliver(event.kind, event.payload)
      } catch {
        // Keep the event, delay only this event, and let later work proceed. Never persist
        // exception text: provider errors may include credentials or page contents.
        const delaySeconds = Math.min(3600, 5 * 2 ** Math.min(event.attempt_count, 10))
        await tx.execute(sql`update job_outbox
          set attempt_count = least(attempt_count + 1, 1000000),
              next_attempt_at = clock_timestamp() + ${delaySeconds} * interval '1 second',
              last_failure_code = 'delivery_failed'
          where id = ${event.id}`)
        return 'delayed'
      }
      await tx.execute(sql`update job_outbox
        set published_at = clock_timestamp(), attempt_count = least(attempt_count + 1, 1000000),
            last_failure_code = null where id = ${event.id}`)
      return 'published'
    })
    if (found === 'empty') break
    if (found === 'published') published += 1
  }
  return published
}
