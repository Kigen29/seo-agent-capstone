-- The cost guard: a per-tenant monthly cap, and the ledger it is checked against.
--
-- ADR-0016 makes this load-bearing rather than a nicety. Uncontrolled cost is the primary
-- operational risk of a product that makes paid API calls, and the AI-visibility poll turned
-- that from a risk into a certainty: it spends every day, per prompt, per site, forever, with
-- nobody watching. A vendor-side spend limit protects the vendor's billing, not one tenant from
-- another, so the guard has to be ours, before the call, keyed on the tenant.
--
-- Money is stored as micro-dollars (millionths) rather than a decimal, because a single cheap
-- model call costs fractions of a cent and thousands of them have to sum without drift. An
-- integer gets that by construction; a float gets it by luck.
--
-- The default of 5,000,000 micros ($5 a month) is deliberately small. Everything in this product
-- is free until somebody opts into a paid model or a paid data source (ADR-0006), so the first
-- tenant to spend anything should hit a wall they chose to raise, not a bill they did not expect.
ALTER TABLE "tenants"
  ADD COLUMN "monthly_budget_micros" bigint DEFAULT 5000000 NOT NULL;
--> statement-breakpoint

CREATE TABLE "spend" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "micros" bigint NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The guard's only query: this tenant, this month.
CREATE INDEX "spend_tenant_created_idx" ON "spend" ("tenant_id", "created_at");
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "spend" TO seo_app;
--> statement-breakpoint

ALTER TABLE "spend" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spend" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A tenant sees its own spend and nobody else's. This matters more than it looks: the ledger
-- names the provider and model behind every call, so another tenant's rows would leak both what
-- they are running and how heavily they use it.
CREATE POLICY "spend_tenant_isolation" ON "spend"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
