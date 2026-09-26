import type { SocialIdentity } from '@seo/connectors'
import { apiTokens, asOwner, authHandoffs, tenants, userIdentities, type Database } from '@seo/db'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { generateToken, hashToken } from './auth.js'

/**
 * Turning a proven social identity into a tenant, and a tenant into a session.
 *
 * Everything here runs through `asOwner`, and that is not a shortcut. These are operations that
 * logically *precede* a tenant: there is nothing to scope by yet, which is the same reason
 * `tenantForToken` and tenant creation run that way. The safety does not come from row-level
 * security here, it comes from the fact that the only thing any of these functions will act on is
 * an identity a provider has just vouched for, or a code this server minted.
 */

/** How long a handoff code is worth anything. The web app redeems it immediately. */
const HANDOFF_TTL_MS = 2 * 60 * 1000

const hashCode = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex')

export interface ResolvedIdentity {
  tenantId: string
  /** True the first time this account is seen, so the caller can say hello rather than welcome back. */
  created: boolean
}

/**
 * Find the tenant behind this identity, or make one.
 *
 * The lookup is by `(provider, accountId)` and never by email, for the reason the schema gives:
 * an email is a label the user controls and the account id is not. Somebody who changes their
 * GitHub address has to come back as the same person, not as a stranger holding a second empty
 * tenant.
 *
 * The email, name and avatar are refreshed on every sign-in rather than written once. They are
 * display data that lives at the provider, and a dashboard showing a name somebody changed two
 * years ago is a small, avoidable lie.
 */
export async function resolveIdentity(
  db: Database,
  identity: SocialIdentity,
  newTenantBudgetMicros?: number,
): Promise<ResolvedIdentity> {
  const existing = await findIdentity(db, identity)
  if (existing) return { tenantId: existing, created: false }

  try {
    return { tenantId: await createTenantFor(db, identity, newTenantBudgetMicros), created: true }
  } catch {
    /*
      Two first sign-ins for the same account at once.

      The unique index on (provider, provider_account_id) is what decides it, and the loser's
      whole transaction rolls back, tenant included, so there is no orphan. By the time we are
      here the winner has committed, so looking again is guaranteed to find it. Re-running the
      insert instead would just lose again.
    */
    const raced = await findIdentity(db, identity)
    if (raced) return { tenantId: raced, created: false }
    throw new Error('Could not resolve the identity to a tenant.')
  }
}

async function findIdentity(db: Database, identity: SocialIdentity): Promise<string | undefined> {
  const [row] = await asOwner(db, (tx) =>
    tx
      .select({ tenantId: userIdentities.tenantId })
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.provider, identity.provider),
          eq(userIdentities.providerAccountId, identity.accountId),
        ),
      )
      .limit(1),
  )

  if (!row) return undefined

  await asOwner(db, (tx) =>
    tx
      .update(userIdentities)
      .set({
        lastLoginAt: new Date(),
        email: identity.email ?? null,
        name: identity.name ?? null,
        avatarUrl: identity.avatarUrl ?? null,
      })
      .where(
        and(
          eq(userIdentities.provider, identity.provider),
          eq(userIdentities.providerAccountId, identity.accountId),
        ),
      ),
  )

  return row.tenantId
}

/**
 * One transaction, so a tenant cannot exist without the identity that owns it.
 *
 * If the identity insert loses a race the tenant insert is rolled back with it, which is the
 * whole reason these two statements are not two calls.
 */
async function createTenantFor(
  db: Database,
  identity: SocialIdentity,
  budgetMicros: number | undefined,
): Promise<string> {
  return asOwner(db, async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: identity.name ?? identity.email ?? `${identity.provider} ${identity.accountId}`,
        monthlyBudgetMicros: budgetMicros ?? 0,
      })
      .returning({ id: tenants.id })

    if (!tenant) throw new Error('Could not create a tenant.')

    await tx.insert(userIdentities).values({
      tenantId: tenant.id,
      provider: identity.provider,
      providerAccountId: identity.accountId,
      email: identity.email ?? null,
      name: identity.name ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      lastLoginAt: new Date(),
    })

    return tenant.id
  })
}

/**
 * Mint a handoff code: the thing that travels in the redirect URL instead of the session token.
 *
 * Only its hash is stored, exactly as for an API token, because a URL ends up in browser history,
 * in the next request's Referer, and in every log along the way. A code that leaks from there is
 * worth nothing after two minutes and nothing at all once redeemed, which is the difference
 * between an embarrassment and an incident.
 */
export async function createHandoff(db: Database, tenantId: string): Promise<string> {
  const code = randomBytes(32).toString('base64url')

  await asOwner(db, (tx) =>
    tx.insert(authHandoffs).values({
      tenantId,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
    }),
  )

  return code
}

/**
 * Redeem a handoff code, once, and mint the session token it stands for.
 *
 * The consume is a conditional UPDATE rather than a read followed by a write, and that is what
 * makes "once" true rather than merely intended. Two racing redemptions are serialised by
 * Postgres on the row: the first sets `consumed_at` and gets its row back, the second matches
 * nothing because `consumed_at IS NULL` no longer holds. A read-then-write would let both pass
 * the check before either wrote, and hand out two sessions for one sign-in.
 *
 * Returns undefined for a code that is unknown, already used, or expired. The caller must not
 * distinguish between those in what it tells the browser.
 */
export async function redeemHandoff(db: Database, code: string): Promise<string | undefined> {
  const [row] = await asOwner(db, (tx) =>
    tx
      .update(authHandoffs)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authHandoffs.codeHash, hashCode(code)),
          isNull(authHandoffs.consumedAt),
          gt(authHandoffs.expiresAt, new Date()),
        ),
      )
      .returning({ tenantId: authHandoffs.tenantId }),
  )

  if (!row) return undefined

  const token = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({
      tenantId: row.tenantId,
      name: SESSION_TOKEN_NAME,
      kind: 'session',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }),
  )

  await pruneExpiredSessions(db, row.tenantId)

  return token
}

/**
 * The name every browser session is minted under.
 *
 * It is how a human reading their token list tells a session from a token they minted by hand for
 * the CLI or the MCP server. The prune below keys on `kind`, not on this name, so a hand-minted
 * token must never be swept however it is named, because nobody is watching for it to stop working.
 */
export const SESSION_TOKEN_NAME = 'Browser session'

/** Matches the cookie's own Max-Age in `lib/session.ts`. Past this the row cannot be presented. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Drop browser sessions older than the cookie that carries them.
 *
 * Without this, a row accumulates for every sign-in, forever, and a user who signs in daily leaves
 * a year of live credentials behind them. These rows are not merely untidy: each one is a working
 * session token, so the set of things that can be stolen from a database dump grows without bound
 * for no benefit at all.
 *
 * Deleting only what has already expired is what makes this safe to run unattended. The cookie is
 * good for thirty days, so a row older than that cannot be presented by anyone legitimate, and
 * signing in on a second device does not sign you out of the first.
 *
 * Best-effort. Housekeeping must never fail a sign-in.
 */
async function pruneExpiredSessions(db: Database, tenantId: string): Promise<void> {
  try {
    await asOwner(db, (tx) =>
      tx
        .delete(apiTokens)
        .where(
          and(
            eq(apiTokens.tenantId, tenantId),
            eq(apiTokens.kind, 'session'),
            lt(apiTokens.expiresAt, new Date()),
          ),
        ),
    )
  } catch {
    // Housekeeping. Never fail a sign-in over it.
  }
}

/**
 * Revoke the token the caller just presented. What signing out should always have meant.
 *
 * Clearing the cookie alone leaves the credential alive on the server, so a token captured
 * beforehand keeps working for thirty days after the user believed they had signed out. That is
 * the gap between "the browser forgot it" and "it no longer works", and only the second one is
 * what a person means when they click sign out.
 *
 * Deletes exactly the presented token, never every token for the tenant: signing out here must
 * not revoke the CLI token somebody is using elsewhere, or the other browser they are signed in
 * on.
 */
export async function revokeToken(db: Database, token: string): Promise<void> {
  await asOwner(db, (tx) => tx.delete(apiTokens).where(eq(apiTokens.tokenHash, hashToken(token))))
}

/**
 * Sweep expired and spent handoffs.
 *
 * Best-effort housekeeping on a table that would otherwise grow by one row per sign-in forever.
 * Called from the exchange rather than scheduled, because the worker is a cron that runs when
 * GitHub feels like it (#142) and this is far too small a job to deserve one. A failure here must
 * never fail a sign-in, which is why it is caught and dropped.
 */
export async function sweepHandoffs(db: Database): Promise<void> {
  try {
    await asOwner(db, (tx) =>
      tx.delete(authHandoffs).where(sql`${authHandoffs.expiresAt} < now() - interval '1 day'`),
    )
  } catch {
    // Housekeeping. Never fail a sign-in over it.
  }
}
