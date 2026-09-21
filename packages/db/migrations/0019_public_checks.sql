-- The anonymous check (ADR-0025).
--
-- Its own table, with no tenant_id and no row-level security policy, and both of those are the
-- decision rather than an oversight. A check has no tenant: it is created by a stranger with no
-- account, and it belongs to whoever holds its unguessable id. Putting it in an existing table as
-- a tenant-less row would mean every policy in the schema needing a special case for the one row
-- shape that has no owner, which is how a tenancy model develops a hole.
--
-- So the isolation here is structural. This table cannot leak tenant data because it has no way to
-- reference any, and the route that writes it never opens a tenant context.
CREATE TABLE IF NOT EXISTS "public_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What was asked for, and what was actually checked after redirects. Both, because a check of
  -- example.com that silently followed a redirect to a parked domain would otherwise look wrong.
  "url" text NOT NULL,
  "final_url" text NOT NULL,
  -- The findings, the scorecard and the limitations, exactly as the API returned them. Stored
  -- whole for the same reason the audit stores its scorecard whole: a shared link has to render
  -- what the run actually said, not what today's rule engine would say about yesterday's page.
  "result" jsonb NOT NULL,
  -- A salted hash, never the address. Rate limiting needs to recognise a repeat visitor; it does
  -- not need to know who they are, and an IP column is personal data we would then have to
  -- justify holding.
  "ip_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- Results expire. A share link is for showing somebody this week, and an unbounded table on a
  -- free tier is a slow outage.
  "expires_at" timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

-- The per-IP rate limit reads "how many checks from this hash since a timestamp", and the global
-- cap reads "how many checks since a timestamp". One index serves both.
CREATE INDEX IF NOT EXISTS "public_checks_rate_idx" ON "public_checks" ("created_at", "ip_hash");

-- The prune reads this one.
CREATE INDEX IF NOT EXISTS "public_checks_expiry_idx" ON "public_checks" ("expires_at");
