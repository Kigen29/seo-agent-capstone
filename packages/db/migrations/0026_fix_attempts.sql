-- Every attempt to fix a finding, not only the latest failure.
--
-- findings.fix_error keeps the most recent failure and forgets the rest, and a success leaves no
-- trace beyond the PR URL. This table records each attempt the worker makes: when it ran, whether
-- it opened a pull request, reused one a crashed attempt had opened, or failed, and why.
CREATE TABLE fix_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  request_id text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('pr_opened', 'pr_adopted', 'failed')),
  pr_url text,
  error text
);
CREATE INDEX fix_attempts_finding_idx ON fix_attempts (finding_id, finished_at DESC);
ALTER TABLE fix_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY fix_attempts_tenant_isolation ON fix_attempts FOR ALL
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON fix_attempts TO seo_app;
