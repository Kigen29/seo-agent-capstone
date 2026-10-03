ALTER TABLE fix_attempts ALTER COLUMN finished_at DROP NOT NULL;
ALTER TABLE fix_attempts ALTER COLUMN finished_at SET DEFAULT now();
ALTER TABLE fix_attempts DROP CONSTRAINT fix_attempts_outcome_check;
ALTER TABLE fix_attempts ADD CONSTRAINT fix_attempts_outcome_check CHECK (outcome IN ('running', 'pr_opened', 'pr_adopted', 'failed'));
ALTER TABLE findings ADD COLUMN verification_checked_at timestamptz;
ALTER TABLE findings ADD COLUMN traffic_checked_at timestamptz;
CREATE INDEX findings_pending_verification_idx ON findings (verification_checked_at) WHERE status = 'merged';
