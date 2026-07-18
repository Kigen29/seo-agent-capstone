-- Sprint 2, STORY-019: Search Console auto-verification.
-- The property is created and its verification meta tag opened as a PR; these track the state.
ALTER TABLE "sites" ADD COLUMN "gsc_verified" boolean DEFAULT false NOT NULL;
ALTER TABLE "sites" ADD COLUMN "gsc_verification_pr_url" text;
