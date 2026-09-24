import { asOwner, type Database } from '@seo/db'
import { sql } from 'drizzle-orm'

export interface ReservationVerdict {
  allowed: boolean
  reason?: string
  reservationId?: string
}

export function assertMicros(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Cost must be a nonnegative safe integer in micros')
}

/** Serialize global and tenant decisions across every API/worker process. */
export async function reserveSpend(
  db: Database,
  tenantId: string,
  micros: number,
  globalCapMicros = Number(process.env.GLOBAL_MONTHLY_BUDGET_MICROS ?? 0),
): Promise<ReservationVerdict> {
  assertMicros(micros)
  assertMicros(globalCapMicros)
  return asOwner(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(19287, 3)`)
    const result = await tx.execute<{ cap: string; tenant_used: string; global_used: string }>(sql`
      select monthly_budget_micros as cap,
        (select coalesce(sum(micros), 0) from spend where tenant_id = ${tenantId}::uuid
          and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') +
        (select coalesce(sum(reserved_micros), 0) from spend_reservations
          where tenant_id = ${tenantId}::uuid and settled_at is null) as tenant_used,
        (select coalesce(sum(micros), 0) from spend
          where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') +
        (select coalesce(sum(reserved_micros), 0) from spend_reservations
          where settled_at is null) as global_used
      from tenants where id = ${tenantId}::uuid for update`)
    const row = result.rows[0]
    if (!row || BigInt(row.tenant_used) + BigInt(micros) > BigInt(row.cap)) {
      return {
        allowed: false,
        reason: 'Insufficient tenant budget including pending reservations.',
      }
    }
    if (BigInt(row.global_used) + BigInt(micros) > BigInt(globalCapMicros)) {
      return {
        allowed: false,
        reason: 'Insufficient global budget including pending reservations.',
      }
    }
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into spend_reservations (tenant_id, reserved_micros) values (${tenantId}, ${micros}) returning id`)
    return { allowed: true, reservationId: inserted.rows[0]!.id }
  })
}
