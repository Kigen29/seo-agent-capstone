import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { APP_ROLE, TENANT_SETTING } from './rls.js'
import * as schema from './schema/index.js'

export type Database = NodePgDatabase<typeof schema>

/**
 * `pg`, deliberately, and not `@neondatabase/serverless`.
 *
 * ADR-0007 buys a $0 stack on Neon, and pays for it by keeping `DATABASE_URL` as the
 * entire integration surface. The moment we import a vendor driver, that stops being true:
 * the host is no longer swappable, and "we can move to any Postgres" becomes a claim in a
 * document rather than a fact about the code. Nothing here knows it is talking to Neon.
 */
export function createDb(connectionString = process.env.DATABASE_URL): {
  db: Database
  pool: pg.Pool
} {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }

  const pool = new pg.Pool({ connectionString, max: 5 })

  return { db: drizzle(pool, { schema }), pool }
}

/**
 * Drop out of the (BYPASSRLS-carrying) connection role for the rest of this transaction, so
 * that the policies actually apply. Both entry points below start with this, and no query
 * in this package should ever run outside one of them.
 *
 * SET LOCAL, like set_config(..., true), is scoped to the transaction and is undone on
 * commit or rollback, so the pooled connection goes back to the pool as the owner and the
 * next borrower is unaffected.
 */
const enterAppRole = (tx: Database) => tx.execute(sql.raw(`set local role ${APP_ROLE}`))

/**
 * Run a unit of work as one tenant. Every query inside sees only that tenant's rows,
 * because Postgres enforces it, not because the caller remembered a WHERE clause.
 *
 * The transaction is load-bearing, and not only for atomicity. `set_config(..., true)`
 * scopes the tenant to the *transaction*, so it is discarded on commit or rollback. The
 * session-level spelling (`set_config(..., false)`, or a plain `SET`) would outlive the
 * request and stay attached to the pooled connection, so the next request to borrow that
 * connection would silently inherit the previous tenant's identity: only under load, only
 * sometimes, and never in a test. Transaction-local is the difference between multi-tenancy
 * and a race condition.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Database
    await enterAppRole(scoped)
    await scoped.execute(sql`select set_config(${TENANT_SETTING}, ${tenantId}, true)`)
    return work(scoped)
  })
}

/**
 * Run a unit of work with no tenant, for the things that legitimately have none: creating a
 * tenant, and the admin paths.
 *
 * This does NOT see everything, and that is deliberate. It still runs as `seo_app`, so a
 * tenant-scoped table read from here returns zero rows rather than every tenant's. If you
 * find yourself wanting this function to see across tenants, what you want is an admin role
 * with BYPASSRLS, and you should have to add that on purpose rather than discover you had it
 * all along, which is precisely the trap this package already fell into once.
 *
 * Migrations do not go through here: they need DDL, and run as the owner.
 */
export async function withoutTenant<T>(
  db: Database,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Database
    await enterAppRole(scoped)
    return work(scoped)
  })
}
