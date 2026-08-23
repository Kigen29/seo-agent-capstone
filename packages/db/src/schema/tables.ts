import type {
  AuditMetrics,
  Evidence,
  Framework,
  MetricSnapshot,
  Scorecard,
  VerificationResult,
  VerificationStatus,
} from '@seo/core'
import { frameworkSchema } from '@seo/core'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  date,
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

  /**
   * What this tenant may spend on paid model and data calls in a calendar month, in millionths
   * of a dollar.
   *
   * Micro-dollars, not a decimal, because this is money and floating point is not. A single
   * `fast` call can cost fractions of a cent, so the unit has to be small enough that thousands
   * of them sum without drift, and an integer is the only representation where that is true by
   * construction rather than by luck.
   *
   * Per tenant, because a cap that is not per tenant is not a cap: one runaway prompt list would
   * spend everyone else's allowance (ADR-0016).
   */
  monthlyBudgetMicros: bigint('monthly_budget_micros', { mode: 'number' })
    .notNull()
    .default(5_000_000),

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

    /**
     * The competitor domains this site is measured against on the AI-visibility and authority
     * axes.
     *
     * Share of voice is meaningless without a named field: "cited twice" says nothing until
     * you know a rival was cited nine times for the same questions. Empty is a perfectly
     * valid state, and the axis then reports citation and stability without a share.
     */
    competitors: text('competitors')
      .array()
      .notNull()
      .default(sql`'{}'`),

    /**
     * The brand name, as a human writes it. Null until somebody says what it is.
     *
     * Not derivable from the domain, which is exactly why it is stored. `heartbeestsafaris.com`
     * yields the stem "heartbeestsafaris", and searching the web for that finds almost nothing,
     * because the press writes "Heartbeest Safaris". Guessing the space back in is a heuristic
     * that would silently under-count the authority axis for every multi-word brand, which is
     * most of them.
     */
    brand: text('brand'),

    /** Search Console property, e.g. 'https://example.com/', set when auto-verification runs. */
    gscProperty: text('gsc_property'),
    /** Where the site is in the auto-verification lifecycle. See VerificationStatus. */
    gscVerificationStatus: text('gsc_verification_status')
      .$type<VerificationStatus>()
      .notNull()
      .default('none'),
    /** The pull request that adds the verification meta tag, while it is open or after merge. */
    gscVerificationPrUrl: text('gsc_verification_pr_url'),

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
    /**
     * The GitHub webhook unbinds every site on an installation when the App is uninstalled, and
     * the repo picker collects a tenant's installations. Both scanned the whole table.
     */
    index('sites_installation_idx').on(table.githubInstallationId),
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

/**
 * The questions we ask the AI answer engines on a site's behalf.
 *
 * These are the client's real customer questions, not keywords, because that is what a person
 * types into ChatGPT. They are stored rather than derived: the whole axis is a longitudinal
 * measurement, and a prompt that changed between polls would silently invalidate the window
 * it is being compared across.
 */
export const visibilityPrompts = pgTable(
  'visibility_prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    prompt: text('prompt').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('visibility_prompts_site_prompt_idx').on(table.siteId, table.prompt)],
)

/**
 * One engine answer, parsed. The raw material the stability score is computed from.
 *
 * Every row is a single observation, never a verdict: `cited` here means one engine cited the
 * client on one day, which ADR-0015 is explicit is not a citation worth reporting. The verdict
 * is an aggregate over rows, and it needs at least three of them on at least three days.
 *
 * `polledOn` is a date, not a timestamp, and it is half of a unique index with the prompt and
 * the engine. That constraint is what makes "three polls over three days" true by construction
 * rather than by the worker behaving: a second drain on the same day cannot insert a second row
 * for the same prompt and engine, so three rows for one engine are always three distinct days,
 * and no amount of re-running the queue can inflate a sample.
 */
export const visibilityChecks = pgTable(
  'visibility_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => visibilityPrompts.id, { onDelete: 'cascade' }),

    /** 'chatgpt', 'perplexity', 'ai_overview', ... */
    engine: text('engine').notNull(),

    cited: boolean('cited').notNull(),
    /** 'citations' when matched against the engine's own source list, 'mention' when not. */
    basis: text('basis').$type<'citations' | 'mention'>().notNull(),
    citedCompetitors: text('cited_competitors')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Every source the engine cited, so a human can check the parser's verdict by hand. */
    sources: text('sources')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** The answer text, truncated. Kept because the consensus range is parsed out of it. */
    answer: text('answer').notNull().default(''),

    /** The UTC day this poll belongs to. See the unique index above. */
    polledOn: date('polled_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('visibility_checks_site_day_idx').on(table.siteId, table.polledOn),
    uniqueIndex('visibility_checks_prompt_engine_day_idx').on(
      table.promptId,
      table.engine,
      table.polledOn,
    ),
  ],
)

/**
 * Every paid call we have made, one row each.
 *
 * A ledger rather than a running total on the tenant, because a total answers "how much" and
 * nothing else. When a bill surprises someone, the only useful question is *what* spent it, and
 * that needs the provider, the model, and the hour. It also makes the cap auditable: the guard's
 * verdict is a sum over rows anyone can re-run by hand.
 *
 * `kind` exists because the LLM is not the only thing that costs money. SERP and AI-Overview data
 * is the other paid dependency (ADR-0016), and it has to sit under the same cap: two separate
 * budgets would let a tenant spend twice what either one allows.
 */
export const spend = pgTable(
  'spend',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** 'llm' or 'serp'. Not an enum: a new paid dependency should not need a migration. */
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),

    /** Millionths of a dollar. See tenants.monthlyBudgetMicros for why it is an integer. */
    micros: bigint('micros', { mode: 'number' }).notNull(),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The guard's only query: this tenant, this month. */
    index('spend_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
)

/** Every table that carries a tenant_id, and therefore every table that needs RLS. */
export const TENANT_SCOPED = [
  sites,
  audits,
  findings,
  artefacts,
  oauthCredentials,
  apiTokens,
  visibilityPrompts,
  visibilityChecks,
  spend,
] as const
