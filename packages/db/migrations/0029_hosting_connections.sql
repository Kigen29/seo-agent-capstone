CREATE UNIQUE INDEX sites_id_tenant_idx ON sites (id, tenant_id);
CREATE TABLE hosting_connections (
  site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  origin text NOT NULL,
  repo_full_name text NOT NULL,
  project_id text NOT NULL,
  team_id text,
  token_encrypted text NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);
ALTER TABLE hosting_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosting_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY hosting_connections_tenant_isolation ON hosting_connections FOR ALL
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM sites WHERE sites.id = hosting_connections.site_id AND sites.tenant_id = hosting_connections.tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON hosting_connections TO seo_app;
