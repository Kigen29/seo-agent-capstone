import type { Framework, VerificationStatus } from '@seo/core'
import { frameworkSchema } from '@seo/core'
import { sql } from 'drizzle-orm'
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/** Who the data belongs to: a tenant, and the sites it audits. */

export const frameworkEnum = pgEnum(
  'framework',
  frameworkSchema.options as unknown as [string, ...string[]],
)

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
  monthlyBudgetMicros: bigint('monthly_budget_micros', { mode: 'number' }).notNull().default(0),

  /**
   * The plan this tenant is on (ADR-0036). A label beside the cap above, which is the one thing
   * a plan changes. Only the billing webhook writes it, after the payment rail's signature has
   * been verified; the browser returning from checkout never does.
   */
  plan: text('plan').$type<'free' | 'growth' | 'agency'>().notNull().default('free'),

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
     * What each competitor is called, by domain, read from its own homepage (ADR-0041).
     *
     * A name, an explicit null (read, and the title states no name), or absent (not read yet).
     * It exists so a competitor is looked for in an AI answer the same way the client is.
     */
    /**
     * Sites the client has said are not about them (ADR-0042). Kept out of their brand mentions,
     * because the exact-name check cannot tell two businesses with the same name apart.
     */
    mentionExclusions: text('mention_exclusions')
      .array()
      .notNull()
      .default(sql`'{}'`),

    competitorNames: jsonb('competitor_names')
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),

    /**
     * How often the site is audited without anybody asking: 'off', 'weekly' or 'monthly'
     * (ADR-0044). Off until chosen, because an audit spends from the tenant's allowance.
     * The set is held by a check constraint and by `auditCadenceSchema` in `@seo/core`.
     */
    auditCadence: text('audit_cadence').notNull().default('off'),

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

    /**
     * What the business offers and where its customers are, as its owner would say it. Free text,
     * optional, and used only to make suggestions specific (migration 0035).
     */
    offering: text('offering'),
    market: text('market'),

    /**
     * The Google Business Profile this site belongs to, as its two public identifiers.
     *
     * Stored for the same reason `brand` is: neither is derivable from the site. The CID is the
     * profile's numeric id (a decimal string, because it exceeds 2^53 and a JavaScript number
     * would silently round it), and it is what a `hasMap` or `sameAs` link in LocalBusiness
     * markup should point at. The Place ID is what builds a "leave a review" link.
     *
     * Null means the client has not connected a profile, and the local axis says so rather than
     * assuming a business has none.
     */
    gbpCid: text('gbp_cid'),
    gbpPlaceId: text('gbp_place_id'),

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
