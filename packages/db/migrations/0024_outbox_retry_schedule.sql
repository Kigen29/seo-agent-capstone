ALTER TABLE job_outbox
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_failure_code text;
CREATE INDEX job_outbox_due_idx ON job_outbox (next_attempt_at, created_at, id)
  WHERE published_at IS NULL;
