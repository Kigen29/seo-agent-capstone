import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenancy.js'

/** Paid work: what was spent, and what is held for work in flight. */

/**
 * Every paid call we have made, one row each.
 *
 * A ledger rather than a running total on the tenant, because a total answers "how much" and
 * nothing else. When a bill surprises someone, the only useful question is *what* spent it, and
 * that needs the provider, the model, and the hour. It also makes the cap auditable: the guard's
 * verdict is a sum over rows anyone can re-run by hand.
 *
 * `kind` exists because the LLM is not the only thing that costs money. SERP and AI-Overview data
 * is the other paid dependency (ADR-0016), and it has to sit under the same cap: two separate
 * budgets would let a tenant spend twice what either one allows.
 */
export const spend = pgTable(
  'spend',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** 'llm' or 'serp'. Not an enum: a new paid dependency should not need a migration. */
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),

    /** Millionths of a dollar. See tenants.monthlyBudgetMicros for why it is an integer. */
    micros: bigint('micros', { mode: 'number' }).notNull(),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The guard's only query: this tenant, this month. */
    index('spend_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
)

export const spendReservations = pgTable(
  'spend_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull(),
    actualMicros: bigint('actual_micros', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    index('spend_reservations_pending_idx')
      .on(table.tenantId)
      .where(sql`${table.settledAt} is null`),
    check('spend_reservations_reserved_micros_check', sql`${table.reservedMicros} >= 0`),
    check('spend_reservations_actual_micros_check', sql`${table.actualMicros} >= 0`),
  ],
)
