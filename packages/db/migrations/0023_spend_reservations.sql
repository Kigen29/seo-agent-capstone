CREATE TABLE spend_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reserved_micros bigint NOT NULL CHECK (reserved_micros >= 0),
  actual_micros bigint CHECK (actual_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX spend_reservations_pending_idx ON spend_reservations (tenant_id) WHERE settled_at IS NULL;
ALTER TABLE spend_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE spend_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY spend_reservations_tenant_isolation ON spend_reservations FOR ALL
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON spend_reservations TO seo_app;
ALTER TABLE tenants ALTER COLUMN monthly_budget_micros SET DEFAULT 0;
