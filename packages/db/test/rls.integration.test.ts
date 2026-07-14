import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, withoutTenant, withTenant, type Database } from '../src/client.js'
import { sites, tenants } from '../src/schema/tables.js'

/**
 * Runs against a real Postgres, because there is no other way to test this.
 *
 * Row-level security is enforced by the database and by nothing else. A mock would be
 * testing our belief about what Postgres does, which is exactly the belief that turns out
 * to be wrong (see the FORCE test below). CI provides a Postgres service container; locally
 * it uses whatever DATABASE_URL points at.
 *
 * Skipped when there is no DATABASE_URL, but never in CI: a security test that quietly
 * skips itself is worse than no test, because the green tick still appears.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

describe.skipIf(!shouldRun)('tenant isolation, enforced by Postgres', () => {
  let db: Database
  let close: () => Promise<void>

  const tenantA = randomUUID()
  const tenantB = randomUUID()

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    close = () => created.pool.end()

    // The tenants table is the root of the ownership chain and carries no tenant_id, so it
    // has no RLS policy and is written without a tenant context. Everything else below is.
    await withoutTenant(db, async (tx) => {
      await tx.insert(tenants).values([
        { id: tenantA, name: 'Tenant A' },
        { id: tenantB, name: 'Tenant B' },
      ])
    })

    await withTenant(db, tenantA, (tx) =>
      tx.insert(sites).values({ tenantId: tenantA, url: 'https://a.example.com' }),
    )
    await withTenant(db, tenantB, (tx) =>
      tx.insert(sites).values({ tenantId: tenantB, url: 'https://b.example.com' }),
    )
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    // Cascades to sites, audits, findings, artefacts, credentials.
    await withoutTenant(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantA))
      await tx.delete(tenants).where(eq(tenants.id, tenantB))
    })
    await close()
  })

  it('runs queries as a role that cannot bypass RLS', () => {
    // The test that would have caught the real bug, and the one I did not think to write.
    //
    // There are three independent ways to skip row-level security, and closing two of them
    // looks identical to closing all three:
    //
    //   1. RLS not enabled on the table    -> closed by ENABLE
    //   2. the role OWNS the table         -> closed by FORCE
    //   3. the role has BYPASSRLS          -> closed by NEITHER
    //
    // Neon grants BYPASSRLS to neondb_owner, which is the role in DATABASE_URL. With ENABLE
    // and FORCE both correctly set, every policy still sat in pg_policies, passed review, and
    // was never consulted: an INSERT stamped with another tenant's id succeeded. Dropping to
    // a non-BYPASSRLS role inside the transaction is what actually closes it.
    return withoutTenant(db, async (tx) => {
      const role = await tx.execute<{ user: string; bypass: boolean }>(sql`
        select current_user as user,
               (select rolbypassrls from pg_roles where rolname = current_user) as bypass
      `)

      expect(role.rows[0]?.user).toBe('seo_app')
      expect(role.rows[0]?.bypass, 'the query role can bypass RLS: policies are decorative').toBe(
        false,
      )
    })
  })

  it('forces RLS on every tenant-scoped table, not merely enables it', () => {
    // The most important test in the package, and the one that would not exist if I had
    // trusted the documentation.
    //
    // ENABLE ROW LEVEL SECURITY does not apply to the table's OWNER. We connect to Neon as
    // neondb_owner, which owns all of these tables. With ENABLE alone, every policy below
    // would exist, would show up in pg_policies, would pass code review, and would be
    // bypassed on every single query. The database would look secured and would not be.
    //
    // relforcerowsecurity is the bit that closes it. Assert on the catalog, because a
    // functional test cannot distinguish "the policy worked" from "the policy was skipped
    // but the query happened to be scoped anyway".
    return withoutTenant(db, async (tx) => {
      const rows = await tx.execute<{ table: string; rls: boolean; forced: boolean }>(sql`
        select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('sites', 'audits', 'findings', 'artefacts', 'oauth_credentials')
      `)

      expect(rows.rows).toHaveLength(5)

      for (const row of rows.rows) {
        expect(row.rls, `${row.table} has RLS disabled`).toBe(true)
        expect(row.forced, `${row.table} does not FORCE RLS: the owner bypasses it`).toBe(true)
      }
    })
  })

  it('leaves no table in the schema unprotected', () => {
    // The regression guard. Every check above names its tables explicitly, so a table added
    // next sprint with a tenant_id and no policy would sail past all of them and be readable
    // by every tenant. This asks the catalog instead of asking me to remember.
    //
    // The allow-list is what a reviewer should be made to argue with: to add a table without
    // RLS, you have to come here and write down why.
    const ALLOWED_WITHOUT_RLS = new Set([
      'tenants', // root of the ownership chain; has no tenant_id to filter on
      '__drizzle_migrations', // migration bookkeeping, written only by the owner
    ])

    return withoutTenant(db, async (tx) => {
      const rows = await tx.execute<{ table: string; rls: boolean; forced: boolean }>(sql`
        select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      `)

      const unprotected = rows.rows
        .filter((r) => !ALLOWED_WITHOUT_RLS.has(r.table))
        .filter((r) => !r.rls || !r.forced)
        .map((r) => r.table)

      expect(unprotected, 'tables with no enforced RLS policy').toEqual([])
    })
  })

  it('shows a tenant only its own rows', async () => {
    const seen = await withTenant(db, tenantA, (tx) => tx.select().from(sites))

    expect(seen.map((s) => s.url)).toEqual(['https://a.example.com'])
  })

  it('returns nothing at all when no tenant is set, rather than everything', async () => {
    // The whole reason to push tenancy into the database. Application-level tenancy fails
    // open: forget the WHERE clause and the query returns every tenant's rows. This fails
    // closed. A forgotten scope is an empty page, not a breach.
    const seen = await withoutTenant(db, (tx) => tx.select().from(sites))

    expect(seen).toEqual([])
  })

  it('refuses to write a row stamped with another tenant id', async () => {
    // WITH CHECK, not USING. A read-side-only policy would let tenant A read only its own
    // rows while cheerfully INSERTing rows owned by B, which is a write-side cross-tenant
    // breach that no amount of SELECT testing would ever surface.
    await expect(
      withTenant(db, tenantA, (tx) =>
        tx.insert(sites).values({ tenantId: tenantB, url: 'https://smuggled.example.com' }),
      ),
    ).rejects.toThrow(/row-level security/i)

    const bSites = await withTenant(db, tenantB, (tx) => tx.select().from(sites))
    expect(bSites.map((s) => s.url)).toEqual(['https://b.example.com'])
  })

  it('cannot update or delete another tenant rows, and reports zero rows touched', async () => {
    // The dangerous shape here is a silent no-op that the caller reads as success. RLS makes
    // the rows invisible, so the UPDATE matches nothing and Postgres reports rowCount 0. That
    // is the correct outcome, and asserting on the count is what proves the write was blocked
    // rather than merely appearing to have been applied.
    await withTenant(db, tenantA, async (tx) => {
      const updated = await tx
        .update(sites)
        .set({ url: 'https://hijacked.example.com' })
        .where(eq(sites.tenantId, tenantB))

      expect(updated.rowCount).toBe(0)

      const deleted = await tx.delete(sites).where(eq(sites.tenantId, tenantB))
      expect(deleted.rowCount).toBe(0)
    })

    const bSites = await withTenant(db, tenantB, (tx) => tx.select().from(sites))
    expect(bSites.map((s) => s.url)).toEqual(['https://b.example.com'])
  })

  it('discards the tenant identity when the transaction ends', async () => {
    // set_config(..., true) is transaction-local. The session-level spelling would leave the
    // tenant attached to the pooled connection, so the next request to borrow it would
    // inherit the previous tenant's identity: only under load, only sometimes, and never in
    // a test written the obvious way. This is that test written the non-obvious way.
    await withTenant(db, tenantA, (tx) => tx.select().from(sites))

    const leaked = await withoutTenant(db, (tx) =>
      tx.execute<{ tenant: string | null }>(
        sql`select nullif(current_setting('app.tenant_id', true), '') as tenant`,
      ),
    )

    expect(leaked.rows[0]?.tenant).toBeNull()
  })
})
