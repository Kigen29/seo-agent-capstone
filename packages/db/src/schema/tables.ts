import type { Evidence, Framework, MetricSnapshot, Scorecard, VerificationResult } from '@seo/core'
import { frameworkSchema } from '@seo/core'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { auditStatusEnum, axisEnum, effortEnum, findingStatusEnum, severityEnum } from './enums.js'

export const frameworkEnum = pgEnum(
  'framework',
  frameworkSchema.options as unknown as [string, ...string[]],
)

/** Postgres `bytea`. Drizzle has no first-class type for it. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/**
 * The tenant. The root of every ownership chain in the database.
 *
 * The only table with no `tenant_id`, because it *is* the tenant. Everything else carries
 * one, and row-level security keys off it. See `../rls.ts`.
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    url: text('url').notNull(),

    /** The connected repository, "owner/name". Without one we can only advise, never fix. */
    repoFullName: text('repo_full_name'),
    /**
     * The GitHub App installation that grants write access to `repoFullName`. It is what a
     * short-lived installation token is minted from (ADR-0002), so a fix job can open a PR
     * weeks after the user connected, without the user present. Null until the repo is
     * connected. A bigint because installation ids are outgrowing the int range.
     */
    githubInstallationId: bigint('github_installation_id', { mode: 'number' }),
    framework: frameworkEnum('framework').$type<Framework>().notNull().default('unknown'),

    /** Search Console property, e.g. 'sc-domain:example.com'. */
    gscProperty: text('gsc_property'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Unique per tenant, not globally. Two agencies auditing the same public site is a
     * normal thing, not a conflict. A global unique index on `url` would also leak the
     * existence of another tenant's site through a constraint violation, which is a
     * cross-tenant information leak that row-level security cannot catch, because the
     * constraint is checked before any policy runs.
     */
    uniqueIndex('sites_tenant_url_idx').on(table.tenantId, table.url),
  ],
)

export const audits = pgTable(
  'audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    status: auditStatusEnum('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    pagesCrawled: integer('pages_crawled').notNull().default(0),

    /** The eight-axis scorecard, stored whole. There is no column for an overall score. */
    scorecard: jsonb('scorecard').$type<Scorecard>(),

    /** Why the audit failed, when it did. */
    error: text('error'),
  },
  (table) => [index('audits_site_started_idx').on(table.siteId, table.startedAt)],
)

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),

    /** e.g. 'TECH-007'. Not a foreign key: the rules live in code, not in a table. */
    ruleId: text('rule_id').notNull(),

    /**
     * The rule engine's derived identity for this finding, e.g. 'TECH-002#0'. Stable across
     * runs of the same crawl, so the verifier can re-check one finding by name and the
     * inbox does not reshuffle on refresh. Unique within an audit, which is why it is not
     * the primary key.
     */
    key: text('key').notNull(),

    axis: axisEnum('axis').notNull(),
    severity: severityEnum('severity').notNull(),
    confidence: real('confidence').notNull(),

    title: text('title').notNull(),
    evidence: jsonb('evidence').$type<Evidence>().notNull(),
    affectedUrls: text('affected_urls')
      .array()
      .notNull()
      .default(sql`'{}'`),

    estimatedEffort: effortEnum('estimated_effort').notNull(),
    estimatedImpact: integer('estimated_impact').notNull(),

    /**
     * "How would we know this fix failed?" NOT NULL, and that is the whole point.
     *
     * CLAUDE.md rule 3 is now enforced in three independent places: TypeScript will not
     * compile a finding without it, Zod will not parse one, and Postgres will not store
     * one. The first two can be bypassed by anything that reaches the database another
     * way. This one cannot.
     */
    falsification: text('falsification').notNull(),

    /** Can a fixer generate a diff, or is this advice a human has to act on? */
    fixable: boolean('fixable').notNull().default(false),

    status: findingStatusEnum('status').notNull().default('open'),
    prUrl: text('pr_url'),

    /** Captured before the fix, so the verifier has something to compare against. */
    baseline: jsonb('baseline').$type<MetricSnapshot>(),
    verification: jsonb('verification').$type<VerificationResult>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('findings_audit_idx').on(table.auditId),
    index('findings_site_status_idx').on(table.siteId, table.status),
    /** Re-running an audit must not silently duplicate its findings. */
    uniqueIndex('findings_audit_key_idx').on(table.auditId, table.key),
  ],
)

/**
 * Crawl artefacts: the raw HTML, headers, and screenshots a finding's evidence points at.
 *
 * These live in Postgres, gzipped, rather than in an object store, because ADR-0007 buys a
 * $0 stack by refusing to add a second piece of infrastructure. That is a real trade with
 * a real ceiling: blobs in Postgres do not scale, and the migration trigger is roughly
 * 300 MB, at which point these rows move to Cloudflare R2 and nothing else changes.
 *
 * `body` is gzipped at the call site, not by Postgres. TOAST would compress it anyway, but
 * doing it ourselves means the bytes are already small when they cross the wire, and the
 * free tier meters egress.
 */
export const artefacts = pgTable(
  'artefacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),

    url: text('url').notNull(),
    kind: text('kind').notNull(),

    /** gzipped. Decompress at the call site. */
    body: bytea('body').notNull(),
    /** Uncompressed size, so a caller can decide whether to pull it before pulling it. */
    bytes: integer('bytes').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('artefacts_audit_idx').on(table.auditId)],
)

/**
 * OAuth refresh tokens for a tenant's Google account, encrypted at rest.
 *
 * `refreshTokenEncrypted` is ciphertext produced with TOKEN_ENCRYPTION_KEY, never the raw
 * token. A database dump is a plausible way to lose these, and a leaked Search Console
 * refresh token is a live credential to somebody else's business.
 *
 * CLAUDE.md rule 5: OAuth only. There is no password column here and there never will be.
 */
export const oauthCredentials = pgTable(
  'oauth_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(),
    /** The Google account the grant belongs to. Shown in the UI so a user can revoke it. */
    accountEmail: text('account_email'),

    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('oauth_tenant_provider_idx').on(table.tenantId, table.provider)],
)

/**
 * How a request proves which tenant it is.
 *
 * Only the SHA-256 of the token is stored, never the token itself. We can verify a presented
 * token by hashing it; we can never print one back. Losing a token means minting a new one,
 * which is the right trade: a database dump is the most plausible way to lose these, and a
 * leaked token is a live credential to somebody's account.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** Shown in the UI so a human can tell two tokens apart before revoking one. */
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('api_tokens_hash_idx').on(table.tokenHash)],
)

/** Every table that carries a tenant_id, and therefore every table that needs RLS. */
export const TENANT_SCOPED = [
  sites,
  audits,
  findings,
  artefacts,
  oauthCredentials,
  apiTokens,
] as const
