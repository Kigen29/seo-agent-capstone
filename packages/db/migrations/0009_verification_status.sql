-- Sprint 2, STORY-019: the verification lifecycle as a state machine.
-- Replaces the gsc_verified boolean with a status the dashboard drives off:
-- none -> pr_open -> merged -> verified, and back to none when a PR is closed.
ALTER TABLE "sites" DROP COLUMN IF EXISTS "gsc_verified";
ALTER TABLE "sites" ADD COLUMN "gsc_verification_status" text DEFAULT 'none' NOT NULL;
