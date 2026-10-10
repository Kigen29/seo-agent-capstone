import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { bytea } from './bytea.js'
import { sites, tenants } from './tenancy.js'

/** What is observed over time outside an audit: AI answers, competitors, the free page check. */

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
 * What a tracked competitor's public pages said on one day (ADR-0034).
 *
 * Kept only to diff the next snapshot against, so the writer deletes all but the latest two per
 * competitor. That deletion, with the gzip on `body`, is the storage bound: the table's size
 * is a function of how many competitors are tracked, never of how long they have been.
 */
export const competitorSnapshots = pgTable(
  'competitor_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    /** The competitor's host, as configured on the site. */
    competitor: text('competitor').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    pagesRead: integer('pages_read').notNull().default(0),

    /** Why nothing could be read. Null when the snapshot is a real one. */
    note: text('note'),

    /** Gzipped JSON of the pages read and the sitemap's URL list. */
    body: bytea('body').notNull(),
    bytes: integer('bytes').notNull(),
  },
  (table) => [
    index('competitor_snapshots_site_idx').on(table.siteId, table.competitor, table.takenAt),
  ],
)

/** One thing that differed between two consecutive snapshots of a competitor. */
export const competitorChanges = pgTable(
  'competitor_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    competitor: text('competitor').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),

    kind: text('kind').$type<'title' | 'description' | 'h1' | 'new_url'>().notNull(),
    url: text('url').notNull(),
    before: text('before'),
    after: text('after'),
  },
  (table) => [index('competitor_changes_site_idx').on(table.siteId, table.detectedAt)],
)

/**
 * A check run by somebody with no account (ADR-0025).
 *
 * The one table in the schema with no `tenantId`, and the omission is the design. An anonymous
 * check has no tenant to be scoped by, so it is kept structurally apart from everything that does:
 * it holds no foreign key into tenant data and the route that writes it never opens a tenant
 * context. That is a stronger guarantee than a policy, because there is nothing here to leak.
 */
export const publicChecks = pgTable(
  'public_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** What the visitor asked for. */
    url: text('url').notNull(),
    /** What was actually checked, after redirects. */
    finalUrl: text('final_url').notNull(),
    /** The findings, scorecard and limitations, stored whole so a share link renders what ran. */
    result: jsonb('result').notNull(),
    /**
     * A salted hash of the caller's address, for rate limiting.
     *
     * Hashed rather than stored, because the limiter needs to recognise a repeat visitor and does
     * not need to identify one. An IP column would be personal data held for no purpose we could
     * defend.
     */
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Share links are for this week, not forever, and a free-tier table has to be pruned. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Both limits read from here: per-hash since a timestamp, and the global count since one.
    index('public_checks_rate_idx').on(table.createdAt, table.ipHash),
    index('public_checks_expiry_idx').on(table.expiresAt),
  ],
)
