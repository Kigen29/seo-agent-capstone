-- Bring the `tenants` table under our own explicit control.
--
-- It was found with RLS enabled and no policy attached, which in Postgres means deny
-- everything for any role that is not the owner and does not hold BYPASSRLS. It had been
-- reported as disabled earlier in the same database, so something outside these migrations
-- turned it on (Neon enables RLS on new tables in some configurations). The specific cause
-- matters less than the lesson: the security posture of a table must be asserted by a
-- migration, not inherited from whatever the platform happened to do.
--
-- Enabled and FORCEd on purpose, with a policy that says exactly what we mean:
--
--   * a tenant may read its own row, and only its own. seo_app cannot enumerate tenants,
--     which it previously could, and which would have leaked the customer list.
--   * nobody may INSERT, UPDATE, or DELETE a tenant through seo_app at all. There is no
--     policy for those commands, so they are denied.
--
-- Creating a tenant is therefore an owner-only operation, and that is correct rather than
-- inconvenient: onboarding cannot run "as a tenant" because the tenant does not exist yet.
-- The one code path allowed to do it is `asOwner` in src/client.ts, which exists for this
-- and for migrations, and for nothing else.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenants_self_read" ON "tenants";
--> statement-breakpoint
CREATE POLICY "tenants_self_read" ON "tenants"
  FOR SELECT
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
