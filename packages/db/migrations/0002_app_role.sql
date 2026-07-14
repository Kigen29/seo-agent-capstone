-- The application role. Without this, every policy in 0001 is decorative.
--
-- Neon's default role (neondb_owner) has the BYPASSRLS attribute. BYPASSRLS skips
-- row-level security entirely, and FORCE ROW LEVEL SECURITY does not override it: FORCE
-- only removes the *table owner* exemption, which is a different exemption. Connected as
-- neondb_owner, the policies exist, appear in pg_policies, and are never consulted.
--
-- seo_app is NOLOGIN and has no BYPASSRLS, so the policies apply to it. The application
-- connects as the owner and drops to this role for the duration of each transaction
-- (SET LOCAL ROLE, see src/client.ts), which means no second credential to store and no
-- way for a request to run as the owner by accident.
--
-- Migrations still run as the owner, which is why DDL is not granted here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seo_app') THEN
    CREATE ROLE seo_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO seo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO seo_app;
--> statement-breakpoint
-- The owner must be a member of seo_app to be able to SET ROLE to it.
GRANT seo_app TO CURRENT_USER;
