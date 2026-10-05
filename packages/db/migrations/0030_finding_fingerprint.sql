-- A finding's identity across audits (ADR-0029).
--
-- `key` ('TECH-004#3') is a position in one audit's output and moves whenever a page is added, so
-- every audit's findings were strangers to the last one's. `fingerprint` is the rule plus what the
-- finding is about; `first_seen_at` is when that issue was first raised on the site.
ALTER TABLE findings
  ADD COLUMN fingerprint text,
  ADD COLUMN first_seen_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
-- Existing rows. Must equal fingerprintOf() in packages/audit/src/fingerprint.ts: sha256 of
-- "<rule id>|<first affected url>", hex. Rules that now name an explicit subject (duplicate titles,
-- shared canonicals) get a different value from their next audit on, and match from then.
UPDATE findings
SET fingerprint = encode(sha256(convert_to(rule_id || '|' || coalesce(affected_urls[1], ''), 'UTF8')), 'hex'),
    first_seen_at = created_at;
--> statement-breakpoint
-- Carry the earliest sighting forward to every later row of the same issue on the same site.
UPDATE findings f
SET first_seen_at = e.earliest
FROM (
  SELECT site_id, fingerprint, min(created_at) AS earliest
  FROM findings
  GROUP BY site_id, fingerprint
) e
WHERE f.site_id = e.site_id AND f.fingerprint = e.fingerprint AND f.first_seen_at <> e.earliest;
--> statement-breakpoint
CREATE INDEX findings_site_fingerprint_idx ON findings (site_id, fingerprint, created_at DESC);
