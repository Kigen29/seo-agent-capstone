-- Sprint 2, STORY-015: connect a repository.
-- The GitHub App installation that grants write access to a site's repo, so a fix job can
-- mint a short-lived installation token and open a pull request (ADR-0002). Nullable: a site
-- is not connected to a repo until the user installs the App on it.
ALTER TABLE "sites" ADD COLUMN "github_installation_id" bigint;
