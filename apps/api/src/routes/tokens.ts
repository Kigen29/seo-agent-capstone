import { apiTokens, withTenant } from '@seo/db'
import { asc, eq, gt, isNull, ne, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { bearerToken, hashToken } from '../auth.js'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * The credentials that can act as this account, and the power to switch any of them off.
 *
 * Signing out revokes only the token presented, which is right for "I am done on this browser"
 * and useless for "I left a session open on a library computer" or "that CLI token was in a
 * screenshot". These routes cover those: see every live session and token, revoke one by id, or
 * revoke everything except the credential making the request.
 *
 * Nothing here ever returns a token or its hash. We only hold the hash, and even that is not the
 * caller's business: the id is enough to name a row, and the name, kind and dates are enough for a
 * human to recognise it. Every query runs under the tenant's row-level security, so another
 * tenant's token id is a 404, indistinguishable from one that never existed.
 */
export function tokenRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  /** The hash of the credential on this request, so a listing can mark it and a sweep can spare it. */
  const currentHash = (authorization: string | undefined): string => {
    const token = bearerToken(authorization)
    // The auth hook already refused a request without one, so this cannot be empty here.
    return token ? hashToken(token) : ''
  }

  const live = () => or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date()))

  app.get('/auth/tokens', async (request) => {
    const current = currentHash(request.headers.authorization)
    const rows = await withTenant(db, request.tenantId, (tx) =>
      tx
        .select({
          id: apiTokens.id,
          name: apiTokens.name,
          kind: apiTokens.kind,
          tokenHash: apiTokens.tokenHash,
          createdAt: apiTokens.createdAt,
          lastUsedAt: apiTokens.lastUsedAt,
          expiresAt: apiTokens.expiresAt,
        })
        .from(apiTokens)
        // Expired rows cannot be presented, so listing them would only invite revoking the dead.
        .where(live())
        .orderBy(asc(apiTokens.createdAt)),
    )

    return {
      tokens: rows.map(({ tokenHash, createdAt, lastUsedAt, expiresAt, ...row }) => ({
        ...row,
        createdAt: createdAt.toISOString(),
        lastUsedAt: lastUsedAt?.toISOString() ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
        current: tokenHash === current,
      })),
    }
  })

  /**
   * Revoke one credential by id. Revoking the one on this request is allowed and is simply a
   * sign-out; the next request with it is a 401 like any other revoked token.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .delete('/auth/tokens/:id', { schema: { params: uuidParam } }, async (request, reply) => {
      const deleted = await withTenant(db, request.tenantId, (tx) =>
        tx
          .delete(apiTokens)
          .where(eq(apiTokens.id, request.params.id))
          .returning({ id: apiTokens.id }),
      )
      if (deleted.length === 0) return notFound(reply)
      return reply.status(204).send()
    })

  /**
   * Sign out everywhere else. Every session and hand-minted token for this account is deleted
   * except the one making this request, so the person doing the cleanup is not locked out of the
   * page they are using to do it.
   */
  app.post('/auth/tokens/revoke-others', async (request) => {
    const current = currentHash(request.headers.authorization)
    const revoked = await withTenant(db, request.tenantId, (tx) =>
      tx.delete(apiTokens).where(ne(apiTokens.tokenHash, current)).returning({ id: apiTokens.id }),
    )
    return { revoked: revoked.length }
  })
}
