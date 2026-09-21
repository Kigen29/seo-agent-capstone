-- Row-level security on public_checks: enabled, forced, and deliberately with no policies.
--
-- Its own migration rather than an edit to 0019, because 0019 had already been applied by the
-- time this was decided, and an applied migration is a historical record: editing one changes
-- nothing on any database that already ran it while silently diverging from what fresh installs
-- get. That divergence is the whole reason this project hand-writes migrations and registers them
-- in the journal.
--
-- The schema's invariant is that every table has RLS enabled and forced, and this table keeps it
-- rather than being allow-listed out of the test that checks. What it does not have is a policy,
-- and that is the point: `seo_app`, the role every request-path query runs as, is granted nothing
-- here and can read no row at all. The only way in is `asOwner`, whose role carries BYPASSRLS
-- (ADR-0008), which is exactly the path the two anonymous routes use.
--
-- So a signed-in tenant cannot enumerate the URLs strangers have checked, even though those rows
-- belong to no tenant. A table with no owner column is not a table everybody may read.
ALTER TABLE "public_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public_checks" FORCE ROW LEVEL SECURITY;
