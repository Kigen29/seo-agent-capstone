# ADR-0008: Tenant isolation in Postgres, enforced by a role that cannot bypass it

**Status:** Accepted
**Date:** 2026-07-14

## Context

The product is multi-tenant. An agency's audit of one client must never be visible to another tenant, and the consequence of getting this wrong is not a bug report, it is a breach.

There are two ways to enforce it.

**In the application.** Every query carries `WHERE tenant_id = ?`. This works right up until it does not. It fails open: ninety-nine queries carry the filter, the hundredth is written in a hurry, and the mistake is invisible in code review because the query looks exactly like a correct one with a line missing. Nothing about the system notices. The first symptom is a customer seeing another customer's data.

**In the database.** Postgres row-level security attaches the predicate to the table, so it applies to every query whether or not the author remembered it. It fails closed: an unscoped query returns zero rows. A forgotten `WHERE` produces an empty page and a confused developer, which is a bug you find in ten minutes rather than one you find in a support ticket.

We chose the second. The rest of this ADR is about the part that is not obvious, and that we got wrong on the first attempt.

## Decision

**Row-level security on every tenant-scoped table, with the application connecting through a role that has no `BYPASSRLS` attribute.**

Three separate mechanisms let a Postgres role skip row-level security. Closing two of them looks *identical* to closing all three, which is what makes this dangerous:

| # | Exemption | Closed by |
|---|---|---|
| 1 | RLS is not enabled on the table | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |
| 2 | The role **owns** the table | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` |
| 3 | The role has the **`BYPASSRLS`** attribute | **Neither of the above** |

Neon grants `BYPASSRLS` to `neondb_owner`, which is the role in the `DATABASE_URL` it hands you. (A vanilla Postgres container has the same problem by a different route: the default `postgres` role is a superuser, and superusers bypass RLS unconditionally.)

So our first implementation had `ENABLE` and `FORCE` set correctly on all five tables. The policies existed. They appeared in `pg_policies`. They would have passed review. **They were never once consulted**, and an `INSERT` stamped with another tenant's id succeeded. The database looked secured and was not.

The fix is a second role:

- **`seo_app`** is `NOLOGIN`, holds no `BYPASSRLS`, and is granted `SELECT/INSERT/UPDATE/DELETE` and no DDL.
- The application connects as the owner and issues `SET LOCAL ROLE seo_app` at the top of every transaction, so the policies apply for the duration of the request and the connection reverts on commit.
- Migrations continue to run as the owner, because they need DDL.

`NOLOGIN` means there is no second password to store, rotate, or leak, and no way for a request to run as the owner by accident.

### The policy

```sql
USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

`WITH CHECK` is not redundant with `USING`. `USING` governs which rows can be *read*, updated, or deleted; `WITH CHECK` governs which rows can be *written*. With `USING` alone, a tenant reads only its own rows and can still insert rows owned by somebody else, which is a write-side cross-tenant breach that no amount of `SELECT` testing would surface.

`NULLIF` is also not decorative. With the setting absent, `current_setting(..., true)` returns `NULL`, the comparison is `NULL`, and nothing matches: the query fails closed. With the setting present but empty it returns `''`, and `''::uuid` *raises* rather than matching nothing. `NULLIF` collapses the empty case onto the null case, so both spellings of "no tenant" deny.

### Transaction-local, not session-local

The tenant is set with `set_config('app.tenant_id', $1, true)` and the role with `SET LOCAL`. Both are scoped to the transaction and discarded on commit or rollback.

The session-scoped spellings would attach the tenant to the **pooled connection**, so the next request to borrow it would inherit the previous tenant's identity: only under load, only sometimes, and never in a test written the obvious way. Transaction-local is the difference between multi-tenancy and a race condition.

## Consequences

**Good.** Tenancy holds even where we forget it. A query with no tenant context returns nothing rather than everything. The rule is enforced once, in one place, rather than in every query anyone writes from now on.

**Cost.** Every unit of work must go through `withTenant` or `withoutTenant`, because a query outside a transaction runs as the owner and sees nothing (RLS denies) or, worse, everything (if a future migration grants the owner a policy exemption). This is a real constraint on how data access is written, and it is deliberate.

**The tenants table is not protected.** It is the root of the ownership chain and has no `tenant_id` to filter on. It holds an id and a name. Admin-path code can read it; nothing else needs to.

**This is tested against a real Postgres, never a mock.** A mock would test our beliefs about how RLS behaves, and our beliefs were wrong. CI runs a Postgres 18 service container, applies the migrations, and asserts:

- the query role is `seo_app` and `rolbypassrls` is **false** (the check that would have caught the original bug)
- every table in `public` outside a written-down allow-list has RLS *enabled and forced*
- a tenant sees only its own rows
- no tenant context returns zero rows, not all rows
- a cross-tenant `INSERT` is rejected
- a cross-tenant `UPDATE`/`DELETE` touches zero rows
- the tenant identity does not survive the transaction

## Alternatives considered

**A separate `LOGIN` role in `DATABASE_URL`.** The textbook answer, and a slightly harder boundary: the application would be incapable of becoming the owner rather than merely declining to. Rejected because it needs a second credential created out-of-band, stored, and rotated, in a public repo where every secret is a liability, and it buys little over `SET LOCAL ROLE` given the app already holds the owner's credentials anyway. Worth revisiting if the API and the migration runner are ever split into separately deployed services, at which point the API should get its own login role and never see the owner's.

**Schema-per-tenant.** Real isolation, and genuinely stronger. Rejected: migrations become O(tenants), connection pooling gets ugly, and cross-tenant analytics (which the product will want) becomes a union over N schemas.

**Database-per-tenant.** Strongest isolation available. Rejected outright: it is incompatible with a $0 free tier (ADR-0006) and with onboarding a tenant in one HTTP request.
