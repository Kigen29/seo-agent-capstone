import { apiTokens, asOwner, type Database } from '@seo/db'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'

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

  return row.tenantId
}
