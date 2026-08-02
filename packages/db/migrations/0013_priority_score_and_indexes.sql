-- Make the findings inbox paginable, and stop four queries scanning whole tables.
--
-- The blocker was the sort. `priority_score` is severity_weight * confidence * impact /
-- effort_cost, and it was computed in Node after loading every finding the tenant had. A sort
-- that happens in the application cannot be pushed into SQL, and a sort that cannot be pushed
-- into SQL means LIMIT can never be applied: to know the first twenty rows the API had to fetch
-- all of them. Storing the score turns "the twenty most important findings" into an ordinary
-- indexed query.
--
-- Denormalising is a real cost, and the mitigation is that it cannot drift silently: the column
-- is written by the same exported priorityScore() the UI sorts with, and a test asserts they
-- agree for every finding an audit produces.
ALTER TABLE "findings" ADD COLUMN "priority_score" real DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Backfill, so existing findings sort correctly rather than all reading as zero.
--
-- The weights are duplicated here, once, and that duplication is deliberate: the alternative is
-- leaving every historical finding at 0, which would put a real critical below a new info-level
-- one. It is a one-time statement rather than a live code path, so it cannot drift with the
-- formula the way a stored generated column would. Kept in step with packages/core/src/severity.ts
-- and effort.ts as of this migration.
UPDATE "findings" SET "priority_score" =
  (CASE "severity"
     WHEN 'critical' THEN 16.0
     WHEN 'high'     THEN 8.0
     WHEN 'medium'   THEN 4.0
     WHEN 'low'      THEN 2.0
     ELSE 1.0
   END) * "confidence" * "estimated_impact"
  / (CASE "estimated_effort"
       WHEN 'trivial' THEN 1.0
       WHEN 'small'   THEN 2.0
       WHEN 'medium'  THEN 5.0
       ELSE 13.0
     END);
--> statement-breakpoint

-- The inbox's default order. Without it, every page of every filter is a full sort.
CREATE INDEX "findings_audit_priority_idx" ON "findings" ("audit_id", "priority_score");
--> statement-breakpoint

-- Tenant-wide filters (status, axis, severity) that carry no site in the predicate.
CREATE INDEX "findings_tenant_status_idx" ON "findings" ("tenant_id", "status");
--> statement-breakpoint

-- The merge webhook resolves a finding by its pull-request URL under asOwner, so without this it
-- sequentially scanned every finding belonging to every tenant on each delivery.
CREATE INDEX "findings_pr_url_idx" ON "findings" ("pr_url");
--> statement-breakpoint

-- "The latest audit per site, for this tenant" is the first query the inbox runs and the hottest
-- in the API. Only (site_id, started_at) existed, so it scanned and sorted every audit the tenant
-- had ever run before it could pick the newest few.
CREATE INDEX "audits_tenant_started_idx" ON "audits" ("tenant_id", "started_at");
--> statement-breakpoint

-- The uninstall webhook unbinds every site on an installation; the repo picker collects a
-- tenant's installations. Both scanned the whole sites table.
CREATE INDEX "sites_installation_idx" ON "sites" ("github_installation_id");
