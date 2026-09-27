-- What became of each pull request the agent opened: merged, closed without merging, or merged and
-- later reverted.
--
-- Until now a PR closed unmerged reset its finding to open and left no trace, so the product could
-- not say how often people accept its fixes. Merge rate and revert rate are the production ground
-- truth for whether a fix was right (STORY-038), and they need this record.
ALTER TABLE fix_attempts
  ADD COLUMN pr_resolution text CHECK (pr_resolution IN ('merged', 'closed')),
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN reverted_at timestamptz,
  ADD COLUMN revert_pr_url text;
--> statement-breakpoint
-- A revert can only follow a merge.
ALTER TABLE fix_attempts ADD CONSTRAINT fix_attempts_revert_after_merge
  CHECK (reverted_at IS NULL OR pr_resolution = 'merged');
--> statement-breakpoint
-- PRs opened before fix_attempts existed: give each one a row, so the rates cover them. A PR closed
-- unmerged before this migration left no trace at all and cannot be recovered.
INSERT INTO fix_attempts (tenant_id, finding_id, started_at, finished_at, outcome, pr_url, pr_resolution, resolved_at)
SELECT f.tenant_id, f.id, f.created_at, f.created_at, 'pr_opened', f.pr_url,
       CASE WHEN f.status IN ('merged', 'verified', 'rejected') THEN 'merged' END,
       CASE WHEN f.status IN ('merged', 'verified', 'rejected') THEN now() END
FROM findings f
WHERE f.pr_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM fix_attempts a WHERE a.finding_id = f.id AND a.pr_url = f.pr_url);
--> statement-breakpoint
-- Existing attempts whose PR is already merged.
UPDATE fix_attempts a SET pr_resolution = 'merged', resolved_at = now()
FROM findings f
WHERE a.finding_id = f.id AND a.pr_url = f.pr_url AND a.pr_resolution IS NULL
  AND f.status IN ('merged', 'verified', 'rejected');
--> statement-breakpoint
CREATE INDEX fix_attempts_pr_url_idx ON fix_attempts (pr_url) WHERE pr_url IS NOT NULL;
