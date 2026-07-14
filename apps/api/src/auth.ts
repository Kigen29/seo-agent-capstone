import { apiTokens, asOwner, type Database } from '@seo/db'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull, lt, or } from 'drizzle-orm'

/**
 * Authentication, which is the hinge the whole isolation story hangs on.
 *
 * The API cannot call `withTenant` until it knows the tenant. It must not take the caller's
 * word for it: a header saying "I am tenant X" is not authentication, it is a *request* to
 * be tenant X. Honouring one would make row-level security decorative all over again, after
 * all the trouble it took to make it real (ADR-0008).
 *
 * So the tenant is derived from a bearer token, and only from a bearer token. There is no
 * other way into a handler.
 */

const PREFIX = 'seo_'

/** Only the hash is ever stored. Presented tokens are hashed and compared. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

/**
 * Mint a token. Returned once, in plaintext, and never again: we store the hash, so we are
 * incapable of showing it a second time even if asked. Losing it means minting a new one,
 * which is the correct trade.
 */
export function generateToken(): string {
  return `${PREFIX}${randomBytes(32).toString('base64url')}`
}

/**
 * Pull the bearer token out of the Authorization header.
 *
 * Returns undefined for anything malformed rather than guessing. A caller who sends
 * "Bearer" with no token, or a Basic credential, gets a 401, not a best-effort parse.
 */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined

  const [scheme, value, ...rest] = header.split(' ')
  if (rest.length > 0) return undefined
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  if (!value) return undefined

  return value
}

/**
 * Resolve a presented token to a tenant, or to nothing.
 *
 * Runs through `asOwner` because it must: this lookup happens *before* any tenant context
 * exists, and there is nothing yet to scope it by. It belongs to the same small class as
 * creating a tenant, namely operations that logically precede a tenant. That is why the
 * lookup is by `token_hash`, which is unique, rather than by anything a caller can steer.
 */
export async function tenantForToken(db: Database, token: string): Promise<string | undefined> {
  const presented = hashToken(token)

  const [row] = await asOwner(db, (tx) =>
    tx
      .select({ id: apiTokens.id, tenantId: apiTokens.tenantId, tokenHash: apiTokens.tokenHash })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, presented))
      .limit(1),
  )

  if (!row) return undefined

  /**
   * The index lookup above already decided this, so the comparison is belt-and-braces
   * rather than load-bearing. It is here because a later refactor that fetches candidate
   * rows and compares in JavaScript would otherwise introduce a timing side channel without
   * anyone noticing, and the habit is cheaper than the incident.
   */
  const a = Buffer.from(row.tokenHash, 'hex')
  const b = Buffer.from(presented, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined

  await touch(db, row.id)

  return row.tenantId
}

/**
 * How long a `last_used_at` may be stale before we bother rewriting it.
 *
 * Updating it on every request would mean a row rewrite on every authenticated call, which
 * on a free-tier database is a real cost paid for a field nobody reads to the minute. The
 * question it answers is "is this token still in use, or can I revoke it?", and an hour's
 * resolution answers that perfectly.
 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

/**
 * Record that a token was used, so a human can tell a live token from an abandoned one and
 * revoke the abandoned ones.
 *
 * Best-effort, and deliberately so: this is bookkeeping, not authentication. A failure to
 * write it must never turn a valid token into a 401, because that would mean a hiccup in a
 * usage counter could lock a customer out of their own account.
 */
async function touch(db: Database, id: string): Promise<void> {
  const stale = new Date(Date.now() - TOUCH_INTERVAL_MS)

  try {
    await asOwner(db, (tx) =>
      tx
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(
          and(
            eq(apiTokens.id, id),
            or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, stale)),
          ),
        ),
    )
  } catch {
    // Bookkeeping. Never fail a valid request over it.
  }
}
