/**
 * Multi-tenancy, enforced by Postgres rather than by us remembering to write `WHERE
 * tenant_id = ?`.
 *
 * Application-level tenancy fails the same way every time: ninety-nine queries carry the
 * filter, the hundredth does not, and nobody notices until one customer sees another
 * customer's data. Row-level security inverts the default. An unscoped query returns
 * nothing instead of everything, so a forgotten clause produces an empty page, not a breach.
 */
export const TENANT_SETTING = 'app.tenant_id'

/**
 * The role the application actually runs as. This is the part that makes RLS real, and it
 * is not obvious.
 *
 * There are three separate ways a Postgres role can skip row-level security, and closing
 * one of them looks exactly like closing all three:
 *
 *   1. RLS is not enabled on the table.        Closed by ENABLE ROW LEVEL SECURITY.
 *   2. The role OWNS the table.                Closed by FORCE ROW LEVEL SECURITY.
 *   3. The role has the BYPASSRLS attribute.   Closed by NEITHER of the above.
 *
 * Neon grants BYPASSRLS to its default role, `neondb_owner`, which is the role in
 * DATABASE_URL. So with ENABLE and FORCE both set, every policy below still sat in
 * pg_policies, looked correct in review, and was never once consulted. Verified, not
 * assumed: connected as the owner, an INSERT stamped with another tenant's id succeeded.
 *
 * `seo_app` is NOLOGIN and has no BYPASSRLS. The application connects as the owner and
 * drops to this role for the duration of each transaction (SET LOCAL ROLE, in client.ts),
 * so there is no second credential to store, and no way to accidentally serve a request as
 * the owner. Migrations continue to run as the owner, which is why seo_app is granted DML
 * and never DDL.
 */
export const APP_ROLE = 'seo_app'

/**
 * ENABLE plus FORCE. Neither is sufficient on its own, and together they are still not
 * sufficient without APP_ROLE above: they close exemptions 1 and 2, not 3.
 *
 * Kept anyway, as defence in depth. If seo_app ever comes to own these tables, or if the
 * app is pointed at a Postgres whose role happens not to have BYPASSRLS, FORCE is what
 * keeps the policies applying.
 */
export const enableRls = (table: string): string[] => [
  `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
]

/**
 * One policy per table, covering every command.
 *
 * `USING` governs what an existing row must satisfy to be seen, updated, or deleted.
 * `WITH CHECK` governs what a new or modified row must satisfy to be written. Both are
 * needed. `USING` alone lets a tenant read only its own rows while happily INSERTing rows
 * stamped with somebody else's tenant_id, which is a write-side cross-tenant breach that no
 * amount of SELECT testing would ever surface.
 *
 * NULLIF is load-bearing. With the setting absent, `current_setting(..., true)` returns
 * NULL, the comparison is NULL, and no rows match: the query fails closed, which is what we
 * want. But with the setting present and empty it returns '', and `''::uuid` raises
 * `invalid input syntax for type uuid` instead of matching nothing. NULLIF collapses the
 * empty case back onto the NULL case, so both spellings of "no tenant" deny, rather than one
 * denying and the other exploding.
 */
export const tenantPolicy = (table: string): string => `
  CREATE POLICY "${table}_tenant_isolation" ON "${table}"
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('${TENANT_SETTING}', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('${TENANT_SETTING}', true), '')::uuid)
`

/**
 * Every table carrying a tenant_id.
 *
 * `tenants` is deliberately absent: it is the root of the ownership chain and has no
 * tenant_id to filter on. It is an admin-path table, reachable only by code that runs
 * without a tenant context, and it holds nothing but an id and a name.
 */
export const TENANT_SCOPED_TABLES = [
  'sites',
  'audits',
  'findings',
  'artefacts',
  'oauth_credentials',
  'api_tokens',
] as const

/** The full RLS setup, in the order a migration must apply it. */
export function rlsStatements(): string[] {
  return TENANT_SCOPED_TABLES.flatMap((table) => [...enableRls(table), tenantPolicy(table).trim()])
}
