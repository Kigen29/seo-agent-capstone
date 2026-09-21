import { runQuickCheck, type QuickCheckResult } from '@seo/audit'
import { UnsafeUrlError } from '@seo/connectors'
import { asOwner, publicChecks } from '@seo/db'
import { and, count, eq, gt, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { RouteDeps } from '../options.js'

/**
 * The one anonymous door (ADR-0025).
 *
 * Everything else in this API derives a tenant from a bearer token before a handler runs. These
 * two routes run with no tenant at all, and the safety is structural rather than procedural: they
 * touch exactly one table, that table has no `tenant_id`, and there is no path from here into
 * anything that does.
 *
 * Three protections, in the order they matter:
 *
 *   1. **The fetch is guarded** by `publicFetch`, which refuses private addresses, re-checks every
 *      redirect and caps what it reads. Without that this endpoint is an internal port scanner.
 *   2. **A global daily cap**, which is what actually protects the deployment. IPs are cheap and
 *      a per-IP limit alone stops one impatient visitor, not a coordinated one.
 *   3. **A per-IP limit**, which stops the impatient visitor cheaply and keeps the global cap for
 *      the case it is for.
 */

/** What one address may run in a day. Enough to try a few pages, not enough to crawl a site. */
const PER_IP_DAILY = 5

/**
 * What the whole deployment may run in a day.
 *
 * The number that bounds the damage. It is deliberately low: this runs on a free tier with hard
 * ceilings (ADR-0006), and a visitor told to come back tomorrow is a worse first impression than a
 * bill this project cannot pay, which is the trade the ADR records.
 */
const GLOBAL_DAILY = 200

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A salted hash of the caller's address.
 *
 * Hashed because the limiter needs to recognise a repeat visitor and does not need to identify
 * one. Salted with the token encryption key, which every deployment already has, so the hashes are
 * not a rainbow table away from the addresses that produced them.
 */
function hashAddress(request: FastifyRequest): string {
  const salt = process.env.TOKEN_ENCRYPTION_KEY ?? 'unsalted'
  return createHash('sha256').update(`${salt}:${request.ip}`).digest('hex')
}

export function checkRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps
  const perIpDaily = options.checkLimits?.perIpDaily ?? PER_IP_DAILY
  const globalDaily = options.checkLimits?.globalDaily ?? GLOBAL_DAILY

  /**
   * Run a check for anybody.
   *
   * `asOwner` rather than `withTenant`, because there is no tenant to open a context for. This is
   * the same small class of operations ADR-0009 already recognised: things that logically precede
   * a tenant, like resolving a token or creating one. The class is meant to stay countable on one
   * hand, and this is the third member.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/check',
      { schema: { body: z.object({ url: z.string().min(4).max(2048) }) } },
      async (request, reply) => {
        const since = new Date(Date.now() - DAY_MS)
        const ipHash = hashAddress(request)

        const [limits] = await asOwner(db, (tx) =>
          tx
            .select({
              global: count(),
              mine: sql<number>`count(*) filter (where ${publicChecks.ipHash} = ${ipHash})`,
            })
            .from(publicChecks)
            .where(gt(publicChecks.createdAt, since)),
        )

        if ((limits?.global ?? 0) >= globalDaily) {
          return reply.status(429).send({
            error: 'Too Many Requests',
            message:
              'This free check has run its daily limit. It runs on a free tier, and the cap is what ' +
              'keeps it free. Try again tomorrow, or sign in to audit a whole site.',
          })
        }

        if (Number(limits?.mine ?? 0) >= perIpDaily) {
          return reply.status(429).send({
            error: 'Too Many Requests',
            message: `That is ${perIpDaily} checks from here today, which is the limit. Sign in to audit a whole site.`,
          })
        }

        let result: QuickCheckResult
        try {
          result = await runQuickCheck(request.body.url, {
            ...(options.checkFetch ? { fetch: options.checkFetch } : {}),
            ...(options.checkResolve ? { resolve: options.checkResolve } : {}),
          })
        } catch (error) {
          // A refusal is a fact about the URL somebody pasted, so it comes back as a 400 carrying
          // its own explanation rather than as a 500 that tells them nothing.
          if (error instanceof UnsafeUrlError) {
            return reply.status(400).send({ error: 'Bad Request', message: error.message })
          }
          throw error
        }

        const [saved] = await asOwner(db, (tx) =>
          tx
            .insert(publicChecks)
            .values({
              url: result.url,
              finalUrl: result.finalUrl,
              result,
              ipHash,
              expiresAt: new Date(Date.now() + 30 * DAY_MS),
            })
            .returning({ id: publicChecks.id }),
        )

        return { id: saved?.id, ...result }
      },
    )

  /**
   * Read a check back by its id.
   *
   * The id is a random uuid and is the whole of the authorisation: whoever has the link can see
   * the result. That is the right model for a thing with no owner, and it is why the page it
   * renders on is `noindex` and why results expire.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/check/:id',
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        const [row] = await asOwner(db, (tx) =>
          tx
            .select({ result: publicChecks.result, expiresAt: publicChecks.expiresAt })
            .from(publicChecks)
            .where(eq(publicChecks.id, request.params.id))
            .limit(1),
        )

        // An expired result and one that never existed answer the same way. A "this expired" message
        // would confirm that an id somebody guessed was once real.
        if (!row || row.expiresAt.getTime() < Date.now()) {
          return reply.status(404).send({ error: 'Not Found', message: 'No check with that id.' })
        }

        return { id: request.params.id, ...(row.result as QuickCheckResult) }
      },
    )

  /** Drop expired results. Called by the worker's sweep; safe to call at any time. */
  app
    .withTypeProvider<ZodTypeProvider>()
    .delete(
      '/check/expired',
      { schema: { headers: z.object({ 'x-prune-token': z.string().min(8) }).passthrough() } },
      async (request, reply) => {
        const expected = process.env.PRUNE_TOKEN
        if (!expected || request.headers['x-prune-token'] !== expected) {
          return reply.status(404).send({ error: 'Not Found', message: 'No such route.' })
        }

        const deleted = await asOwner(db, (tx) =>
          tx
            .delete(publicChecks)
            .where(and(gt(sql`now()`, publicChecks.expiresAt)))
            .returning({ id: publicChecks.id }),
        )

        return { deleted: deleted.length }
      },
    )
}
