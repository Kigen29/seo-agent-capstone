-- How often a site is audited without anybody pressing the button (ADR-0044).
--
-- Until now an audit ran only when a person asked for one, so the loop this product is built on
-- (fix, merge, verify, prove the movement) stopped the day somebody stopped visiting. A scheduled
-- audit is what keeps the record going.
--
-- 'off' for every existing site and every new one. A crawl is free, but an audit also embeds the
-- site's pages for the topic map, which is paid work against the tenant's allowance, and spending
-- on a schedule is something a person turns on, not something a migration turns on for them.
--
-- A text column with a check, not an enum: the set is three words and may grow, and adding a
-- value to a Postgres enum cannot run inside the transaction a migration runs in.
ALTER TABLE sites ADD COLUMN audit_cadence text NOT NULL DEFAULT 'off';
ALTER TABLE sites
  ADD CONSTRAINT sites_audit_cadence_check CHECK (audit_cadence IN ('off', 'weekly', 'monthly'));
