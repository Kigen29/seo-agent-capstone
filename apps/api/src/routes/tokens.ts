import { apiTokens, withTenant } from '@seo/db'
import { and, asc, count, eq, gt, isNull, ne, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { bearerToken, generateToken, hashToken } from '../auth.js'
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
/** How long a token made in the dashboard may live. There is no "never" on this list. */
export const TOKEN_LIFETIMES_DAYS = [30, 90, 365] as const

/** The most tokens an account may hold at once. A person has a handful of machines, not fifty. */
export const MAX_TOKENS_PER_ACCOUNT = 10

const NAME_MAX = 60

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
   * Make a token, for the MCP server or the command line (ADR-0046).
   *
   * The token is returned once, in this response, and never again: only its hash is stored, so
   * there is nothing to show a second time.
   *
   * Three limits, each for a reason:
   *
   *   - Only a browser session may call this. A token cannot make a token. If one leaks, whoever
   *     holds it can use the account until it is revoked, and must not be able to mint a second
   *     credential that outlives the revocation.
   *   - Every token expires. The choices are a month, three months and a year. A credential
   *     nobody remembers making is the one that turns up in a screenshot three years later.
   *   - An account holds at most ten. Past that the answer is to revoke one, which is also the
   *     moment a person looks at the list.
   */
  app.withTypeProvider<ZodTypeProvider>().post(
    '/auth/tokens',
    {
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(NAME_MAX),
          expiresInDays: z
            .number()
            .int()
            .refine((days) => (TOKEN_LIFETIMES_DAYS as readonly number[]).includes(days), {
              message: `Choose ${TOKEN_LIFETIMES_DAYS.join(', ')} days.`,
            }),
        }),
      },
    },
    async (request, reply) => {
      const current = currentHash(request.headers.authorization)
      const token = generateToken()
      const expiresAt = new Date(Date.now() + request.body.expiresInDays * 86_400_000)

      const result = await withTenant(db, request.tenantId, async (tx) => {
        const [caller] = await tx
          .select({ kind: apiTokens.kind })
          .from(apiTokens)
          .where(eq(apiTokens.tokenHash, current))
          .limit(1)
        if (caller?.kind !== 'session') return 'not_a_session' as const

        const [held] = await tx
          .select({ total: count() })
          .from(apiTokens)
          .where(and(eq(apiTokens.kind, 'token'), live()))
        if ((held?.total ?? 0) >= MAX_TOKENS_PER_ACCOUNT) return 'too_many' as const

        const [row] = await tx
          .insert(apiTokens)
          .values({
            tenantId: request.tenantId,
            name: request.body.name,
            kind: 'token',
            tokenHash: hashToken(token),
            expiresAt,
          })
          .returning({ id: apiTokens.id, name: apiTokens.name })
        return row!
      })

      if (result === 'not_a_session') {
        return reply.status(403).send({
          error: 'Forbidden',
          message:
            'A token cannot create another token. Sign in to the dashboard and create it there.',
        })
      }
      if (result === 'too_many') {
        return reply.status(409).send({
          error: 'Conflict',
          message: `This account already has ${MAX_TOKENS_PER_ACCOUNT} tokens, which is the limit. Revoke one you no longer use, then create another.`,
        })
      }

      return reply
        .status(201)
        .send({ id: result.id, name: result.name, token, expiresAt: expiresAt.toISOString() })
    },
  )

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
