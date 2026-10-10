import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sites, tenants } from './tenancy.js'

/** Who may act, and what the product may reach for them: tokens, sign-ins and connections. */

/**
 * One site's own hosting connection, used only to confirm that a merged fix is what the site's
 * domain now serves (ADR-0028).
 *
 * Per site and per tenant on purpose. Verification first worked through one operator-wide Vercel
 * token, which could only ever see the operator's own projects: every other customer's fix stayed
 * unverified, and widening that token's access would have made one credential the key to every
 * customer's hosting account.
 *
 * `tokenEncrypted` is ciphertext of `{ tenantId, siteId, token }`, so a row copied onto another
 * site decrypts to a binding that does not match and is refused. `origin` and `repoFullName` are
 * what the connection was validated against; if the site's URL or repository changes, the worker
 * refuses it until it is validated again. `revision` changes on every replacement, so a
 * verification that started under one credential cannot be saved under another.
 */
export const hostingConnections = pgTable('hosting_connections', {
  siteId: uuid('site_id')
    .primaryKey()
    .references(() => sites.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  revision: uuid('revision').notNull().defaultRandom(),
  origin: text('origin').notNull(),
  repoFullName: text('repo_full_name').notNull(),
  projectId: text('project_id').notNull(),
  teamId: text('team_id'),
  tokenEncrypted: text('token_encrypted').notNull(),
  validatedAt: timestamp('validated_at', { withTimezone: true }).notNull().defaultNow(),
})

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
    /**
     * `session` for a browser sign-in, `token` for one minted by hand for the CLI or MCP server.
     * A column rather than a naming convention, so a hand-minted token that happens to be called
     * "Browser session" is never swept as one, and a renamed session never escapes its expiry.
     */
    kind: text('kind').$type<'session' | 'token'>().notNull().default('token'),
    /** Past this the token is refused. Null means it lives until revoked. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('api_tokens_hash_idx').on(table.tokenHash)],
)

/**
 * Who a person is, at GitHub or Google.
 *
 * Keyed on (provider, providerAccountId), never on the email. An email is a label the user
 * controls and can change; the account id is stable for the life of the account. Matching on
 * email would mean somebody who changes their GitHub address comes back as a stranger and gets a
 * second, empty tenant, and it would mean two people who ever shared an address could collide.
 * The email is here to be displayed, and for nothing else.
 *
 * Looked up before any tenant context exists, so the lookup runs through `asOwner`, the same
 * small class of operations as resolving an API token and creating a tenant.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** 'github' or 'google'. Not an enum: a third provider should not need a migration. */
    provider: text('provider').notNull(),
    /** The provider's own stable id for this account. Never the email. */
    providerAccountId: text('provider_account_id').notNull(),

    email: text('email'),
    name: text('name'),
    avatarUrl: text('avatar_url'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('user_identities_provider_account_idx').on(table.provider, table.providerAccountId),
  ],
)

/**
 * How a freshly minted token crosses from the API's origin to the web app's.
 *
 * The API is on Render and the web app is on Vercel, so the API cannot set the web app's cookie.
 * The shortcut is to redirect back with the token in the query string, and it is the wrong one: a
 * URL reaches browser history, the next request's Referer, and every log on the way, and this one
 * would be carrying a live credential. `oauth-callbacks.ts` already refuses to put secrets in
 * redirects for the same reason, and this is the same rule applied to the session itself.
 *
 * So the redirect carries a code that is worth nothing alone, and the web app's *server* trades
 * it for the token, once. Only the hash of the code is stored, exactly like a token.
 */
export const authHandoffs = pgTable(
  'auth_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set by the exchange. Its presence is what makes a code single use. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('auth_handoffs_code_idx').on(table.codeHash)],
)
