-- Signing in with GitHub or Google, without changing what a session is.
--
-- The session stays exactly what it was: an API token, hashed in api_tokens, presented as a
-- bearer credential, resolved to a tenant before any handler runs. Social sign-in is a new way
-- to *obtain* one of those, not a second kind of session. That is deliberate, and it is why this
-- migration adds no column to api_tokens and changes nothing about how a request proves who it
-- is: row-level security, withTenant, the MCP server and every existing token keep working
-- untouched, because none of them can tell how the token was minted.
--
-- Two tables, and they exist for two different reasons.

-- 1. Who this person is, at the provider.
--
-- Keyed on (provider, provider_account_id) rather than on the email, because an email is a
-- label the user controls and can change, while the account id is stable for the life of the
-- account. Matching on email would mean somebody who changes their GitHub email address comes
-- back as a stranger and gets a second, empty tenant; worse, it would mean two people who have
-- ever shared an address could collide. The email is stored for display and nothing else.
--
-- Looked up BEFORE any tenant context exists, so it runs through asOwner, exactly like the
-- api_tokens lookup and for exactly the same reason: it is an operation that logically precedes
-- a tenant and therefore cannot be scoped by one.
CREATE TABLE "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "email" text,
  "name" text,
  "avatar_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_account_idx"
  ON "user_identities" ("provider", "provider_account_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_identities" TO seo_app;
--> statement-breakpoint
ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "user_identities_tenant_isolation" ON "user_identities"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- 2. How the token crosses from the API's origin to the web app's.
--
-- The web app is on Vercel and the API is on Render, so the API cannot set the web app's cookie:
-- different registrable domains, no shared parent. The obvious shortcut is to redirect back with
-- the token in the query string, and it is the wrong one. A URL is written to browser history,
-- to the Referer header of the next request, and to every proxy and server log on the way, and
-- this particular URL would carry a live credential to somebody's account. oauth-callbacks.ts
-- already refuses to put secrets in redirects for the same reason.
--
-- So the redirect carries a handoff code instead, and the code is worth nothing on its own: the
-- web app's *server* posts it back to exchange it for the real token, once. Only the SHA-256 of
-- the code is stored here, like a token, so this table is not a second place a credential can
-- leak from.
--
-- consumed_at is what makes it single use, and the exchange marks it with a conditional UPDATE
-- rather than a read followed by a write. Two racing exchanges then cannot both win: Postgres
-- serialises them on the row, the first sets consumed_at, and the second matches nothing.
CREATE TABLE "auth_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_handoffs_code_idx" ON "auth_handoffs" ("code_hash");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_handoffs" TO seo_app;
--> statement-breakpoint
ALTER TABLE "auth_handoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_handoffs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "auth_handoffs_tenant_isolation" ON "auth_handoffs"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
