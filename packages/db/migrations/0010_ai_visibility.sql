-- The AI-visibility poll window: the prompts we ask, and every engine answer we parsed.
--
-- The shape of these two tables is the honesty of the axis (ADR-0015). A citation is not a
-- fact about one answer, it is a claim about a distribution: roughly 45% of citations appear
-- in only one of three checks, so a single row here is an observation and never a verdict.
-- The verdict is an aggregate, and it needs at least three observations across at least three
-- different days before it is allowed to say anything at all.
--
-- The competitor list lives on the site because share of voice is meaningless without a named
-- field to compare against.
ALTER TABLE "sites" ADD COLUMN "competitors" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint

CREATE TABLE "visibility_prompts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "prompt" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- One row per question per site. A prompt is a longitudinal measurement, so the same question
-- asked twice must accumulate into one window rather than fork into two half-samples.
CREATE UNIQUE INDEX "visibility_prompts_site_prompt_idx"
  ON "visibility_prompts" ("site_id", "prompt");
--> statement-breakpoint

CREATE TABLE "visibility_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "prompt_id" uuid NOT NULL REFERENCES "visibility_prompts"("id") ON DELETE CASCADE,
  "engine" text NOT NULL,
  "cited" boolean NOT NULL,
  "basis" text NOT NULL,
  "cited_competitors" text[] DEFAULT '{}' NOT NULL,
  "sources" text[] DEFAULT '{}' NOT NULL,
  "answer" text DEFAULT '' NOT NULL,
  "polled_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "visibility_checks_site_day_idx" ON "visibility_checks" ("site_id", "polled_on");
--> statement-breakpoint

-- The constraint that makes "three polls over three days" true by construction rather than by
-- the worker behaving itself. The scheduled sweep runs every fifteen minutes as a safety net,
-- and a retried job re-runs whatever it was given; without this, a day of retries would insert
-- twenty rows for one prompt and the stability score would read them as twenty independent
-- checks. With it, a second poll on the same day for the same prompt and engine is rejected,
-- so a sample can only grow by a day passing.
CREATE UNIQUE INDEX "visibility_checks_prompt_engine_day_idx"
  ON "visibility_checks" ("prompt_id", "engine", "polled_on");
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "visibility_prompts" TO seo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "visibility_checks" TO seo_app;
--> statement-breakpoint

ALTER TABLE "visibility_prompts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visibility_prompts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "visibility_prompts_tenant_isolation" ON "visibility_prompts"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "visibility_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visibility_checks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "visibility_checks_tenant_isolation" ON "visibility_checks"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
