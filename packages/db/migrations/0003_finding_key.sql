-- The rule engine derives a stable identity for each finding ('TECH-002#0'): same crawl,
-- same finding, same id, so the verifier can ask "is TECH-002#0 still there?" after a fix
-- and the inbox does not reshuffle on every refresh.
--
-- That identity is not a uuid, and it is only unique within an audit, so it cannot be the
-- primary key. It gets its own column, and a uuid stays as the surrogate key that URLs and
-- foreign keys point at.
ALTER TABLE "findings" ADD COLUMN "key" text NOT NULL;
--> statement-breakpoint
-- Re-running the same audit must not silently duplicate findings.
CREATE UNIQUE INDEX "findings_audit_key_idx" ON "findings" ("audit_id", "key");
