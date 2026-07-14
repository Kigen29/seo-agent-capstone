CREATE TYPE "public"."audit_status" AS ENUM('queued', 'crawling', 'evaluating', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."axis" AS ENUM('crawl_health', 'performance', 'content', 'structure', 'authority', 'local', 'ai_visibility', 'agent_readiness');--> statement-breakpoint
CREATE TYPE "public"."effort" AS ENUM('trivial', 'small', 'medium', 'large');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'pr_open', 'merged', 'verified', 'rejected', 'wontfix');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."framework" AS ENUM('next', 'nuxt', 'astro', 'sveltekit', 'remix', 'gatsby', 'react_spa', 'wordpress', 'hugo', 'jekyll', 'django', 'rails', 'unknown');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artefacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"body" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"status" "audit_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"scorecard" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"axis" "axis" NOT NULL,
	"severity" "severity" NOT NULL,
	"confidence" real NOT NULL,
	"title" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"affected_urls" text[] DEFAULT '{}' NOT NULL,
	"estimated_effort" "effort" NOT NULL,
	"estimated_impact" integer NOT NULL,
	"falsification" text NOT NULL,
	"fixable" boolean DEFAULT false NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"pr_url" text,
	"baseline" jsonb,
	"verification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_email" text,
	"refresh_token_encrypted" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"repo_full_name" text,
	"framework" "framework" DEFAULT 'unknown' NOT NULL,
	"gsc_property" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artefacts" ADD CONSTRAINT "artefacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artefacts" ADD CONSTRAINT "artefacts_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audits" ADD CONSTRAINT "audits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artefacts_audit_idx" ON "artefacts" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audits_site_started_idx" ON "audits" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_audit_idx" ON "findings" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_site_status_idx" ON "findings" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_tenant_provider_idx" ON "oauth_credentials" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sites_tenant_url_idx" ON "sites" USING btree ("tenant_id","url");