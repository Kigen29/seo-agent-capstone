-- How a request proves which tenant it is.
--
-- The API cannot call withTenant until it knows the tenant, and it must not take the
-- tenant's word for it: a header saying "I am tenant X" is not authentication, it is a
-- request to be tenant X, and honouring it would make row-level security decorative all
-- over again.
--
-- Only the SHA-256 of the token is stored, never the token. A database dump is the most
-- plausible way to lose these, and a leaked token is a live credential to somebody's
-- account. We can verify a presented token by hashing it; we can never print one back.
-- Losing a token means minting a new one, which is the correct trade.
--
-- Looking a token up necessarily happens BEFORE any tenant context exists, so it runs
-- through asOwner, exactly like creating a tenant. Both belong to the same small class:
-- operations that logically precede a tenant, and therefore cannot be scoped by one.
CREATE TABLE "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_idx" ON "api_tokens" ("token_hash");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api_tokens" TO seo_app;
--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A tenant may see its own tokens (to list and revoke them), and nothing else. The hash is
-- useless to an attacker who has it, but the existence and names of another tenant's tokens
-- are still not theirs to read.
CREATE POLICY "api_tokens_tenant_isolation" ON "api_tokens"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
