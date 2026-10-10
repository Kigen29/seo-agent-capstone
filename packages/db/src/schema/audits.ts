import type {
  AuditMetrics,
  Evidence,
  MetricSnapshot,
  Scorecard,
  VerificationResult,
} from '@seo/core'
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { bytea } from './bytea.js'
import { auditStatusEnum, axisEnum, effortEnum, findingStatusEnum, severityEnum } from './enums.js'
import { sites, tenants } from './tenancy.js'

/** An audit, what it found, each attempt to fix a finding, and the crawl it kept. */

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

    /**
     * The numbers each axis measured, kept rather than summarised into prose.
     *
     * Stored whole for the same reason the scorecard is: the shape is "what this run measured"
     * and axes keep arriving, so a column per axis would mean a migration per axis. Before this,
     * `measureAuthority` computed referring domains and the unlinked-mention list and persisted a
     * paragraph; a page cannot render a paragraph as a number.
     */
    metrics: jsonb('metrics').$type<AuditMetrics>(),

    /** Why the audit failed, when it did. */
    error: text('error'),
  },
  (table) => [
    index('audits_site_started_idx').on(table.siteId, table.startedAt),
    /**
     * "The latest audit per site, for this tenant" is the first query the findings inbox runs and
     * the hottest in the API. Only `(site_id, started_at)` existed, so it scanned and sorted every
     * audit the tenant had ever run before it could pick the newest few.
     */
    index('audits_tenant_started_idx').on(table.tenantId, table.startedAt),
  ],
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

    /**
     * The same issue on the next audit carries the same value: the rule plus what the finding is
     * about (ADR-0029). `key` cannot do this, because it is a position that moves when a page is
     * added. Nullable only so rows written by older code stay valid; every audit writes it.
     */
    fingerprint: text('fingerprint'),
    /** When this issue was first raised on the site, carried forward from audit to audit. */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),

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
     * `severity_weight * confidence * impact / effort_cost`, computed by `priorityScore()` at
     * write time and stored.
     *
     * Denormalised on purpose, which is the one thing that makes this list paginable. The score
     * was previously computed in Node after loading every finding the tenant had, which meant the
     * sort could never be pushed into SQL, which meant `LIMIT` could never be applied: the API had
     * to fetch everything to know what the first twenty rows were. Storing it turns "the most
     * important twenty findings" into an ordinary indexed query.
     *
     * The cost of denormalising is that it can drift from the formula. It cannot drift silently:
     * the value is written by the same exported function the UI sorts with, and a test asserts the
     * stored column equals `priorityScore()` for every finding an audit produces.
     */
    priorityScore: real('priority_score').notNull().default(0),

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

    /**
     * Why the last attempt to fix this in code failed, or null if none has.
     *
     * A column rather than a new `status`, because a failed attempt does not move the finding
     * along its lifecycle: it is still open, still needs doing, and clicking Fix again is a
     * perfectly reasonable next action. What changed is that we now owe the user an explanation,
     * and an explanation is a fact about the finding rather than a stage of it.
     *
     * It exists because the alternative was what shipped: the API accepted the request, the
     * dashboard said "the agent is opening a pull request", the worker threw into a job log, and
     * the finding sat in the inbox indistinguishable from one nobody had touched. A promise on
     * screen and a failure in a log is worse than never offering the button.
     */
    fixError: text('fix_error'),
    verificationCheckedAt: timestamp('verification_checked_at', { withTimezone: true }),
    trafficCheckedAt: timestamp('traffic_checked_at', { withTimezone: true }),

    /** Captured before the fix, so the verifier has something to compare against. */
    baseline: jsonb('baseline').$type<MetricSnapshot>(),
    verification: jsonb('verification').$type<VerificationResult>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('findings_audit_idx').on(table.auditId),
    index('findings_site_status_idx').on(table.siteId, table.status),
    /** "The newest earlier record of this issue on this site", once per audit and per page view. */
    index('findings_site_fingerprint_idx').on(table.siteId, table.fingerprint, table.createdAt),
    /** Re-running an audit must not silently duplicate its findings. */
    uniqueIndex('findings_audit_key_idx').on(table.auditId, table.key),
    /** The inbox's default order, so the first page is an index scan rather than a sort. */
    index('findings_audit_priority_idx').on(table.auditId, table.priorityScore),
    /** Tenant-wide filters (status, axis, severity) with no site in the predicate. */
    index('findings_tenant_status_idx').on(table.tenantId, table.status),
    /**
     * The merge webhook looks a finding up by its pull-request URL, under `asOwner`, so without
     * this it sequentially scans every finding belonging to every tenant on each delivery.
     */
    index('findings_pr_url_idx').on(table.prUrl),
  ],
)

/**
 * One row per attempt to fix a finding (migration 0026). `findings.fixError` holds only the latest
 * failure; this keeps every attempt, successful or not, so a finding can show its whole history.
 */
export const fixAttempts = pgTable(
  'fix_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    findingId: uuid('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    requestId: text('request_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).defaultNow(),
    outcome: text('outcome').$type<'running' | 'pr_opened' | 'pr_adopted' | 'failed'>().notNull(),
    prUrl: text('pr_url'),
    error: text('error'),
    /** What became of the PR: merged, or closed without merging. Null while it is open. */
    prResolution: text('pr_resolution').$type<'merged' | 'closed'>(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Set when a merged PR was later undone by GitHub's Revert button. */
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertPrUrl: text('revert_pr_url'),
  },
  (table) => [index('fix_attempts_finding_idx').on(table.findingId, table.finishedAt)],
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
