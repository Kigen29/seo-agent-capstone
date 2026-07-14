-- Row-level security: every tenant-scoped table.
-- FORCE is not optional: the table owner bypasses ENABLE-only RLS. See src/rls.ts.

ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sites_tenant_isolation" ON "sites" FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audits_tenant_isolation" ON "audits" FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "findings_tenant_isolation" ON "findings" FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "artefacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artefacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "artefacts_tenant_isolation" ON "artefacts" FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "oauth_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "oauth_credentials_tenant_isolation" ON "oauth_credentials" FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
