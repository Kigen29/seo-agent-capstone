-- Competitor watch (ADR-0034): what a tracked competitor's public pages said last week, and what
-- changed since.
--
-- Two tables because they have two lifetimes. A snapshot is only ever needed to diff the next one
-- against, so the reader keeps the latest two per competitor and deletes the rest: that is the
-- storage bound. A change is small and is the thing a person reads, so it is kept for longer and
-- pruned by age.
CREATE TABLE competitor_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  competitor text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  pages_read integer NOT NULL DEFAULT 0,
  -- Why nothing could be read (their robots.txt refuses us, the site did not answer). Null when
  -- the snapshot is a real one.
  note text,
  -- Gzipped JSON. Titles and URL lists compress to a fraction of their size.
  body bytea NOT NULL,
  bytes integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX competitor_snapshots_site_idx ON competitor_snapshots (site_id, competitor, taken_at DESC);
--> statement-breakpoint
ALTER TABLE competitor_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE competitor_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY competitor_snapshots_tenant_isolation ON competitor_snapshots FOR ALL
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_snapshots TO seo_app;
--> statement-breakpoint
CREATE TABLE competitor_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  competitor text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('title', 'description', 'h1', 'new_url')),
  url text NOT NULL,
  -- Null on both sides for a new URL, which has no before and whose "after" is the URL itself.
  before text,
  after text
);
--> statement-breakpoint
CREATE INDEX competitor_changes_site_idx ON competitor_changes (site_id, detected_at DESC);
--> statement-breakpoint
ALTER TABLE competitor_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE competitor_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY competitor_changes_tenant_isolation ON competitor_changes FOR ALL
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON competitor_changes TO seo_app;
