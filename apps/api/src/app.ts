import cors from '@fastify/cors'
import { getAudit, getFinding, listSites } from '@seo/audit'
import { createDb, sites, withTenant, type Database } from '@seo/db'
import { and, eq } from 'drizzle-orm'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { bearerToken, tenantForToken } from './auth.js'

export interface AppOptions {
  db?: Database
  /** Origins allowed to call the API from a browser. The web app, and nothing else. */
  corsOrigins?: string[]
}

const uuidParam = z.object({ id: z.string().uuid() })

/**
 * Every route is authenticated, and every route is scoped.
 *
 * `request.tenantId` is set by the onRequest hook below, or the request never reaches a
 * handler at all. So there is no way to write a handler that forgets to authenticate: it
 * would have nothing to pass to `withTenant`, and it would not compile.
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string
  }
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const db = options.db ?? createDb().db

  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cors, {
    origin: options.corsOrigins ?? true,
    credentials: true,
  })

  /**
   * A validation failure is a 400, and it says which field, because a caller who cannot see
   * what they got wrong will guess. It must never be a 500: a malformed request is the
   * caller's problem, and reporting it as a server error hides real server errors in the
   * noise.
   */
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: error.message,
      })
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.name, message: error.message })
    }

    // Do not leak internals. The client gets a shrug; the operator gets the stack.
    console.error(error)
    return reply.status(500).send({ error: 'Internal Server Error' })
  })

  /** Render's health check hits this, and it must not require a token. */
  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(async (protectedRoutes) => {
    /**
     * `onRequest`, deliberately, and not `preHandler`.
     *
     * Fastify's lifecycle runs schema validation BEFORE `preHandler`, so authenticating there
     * meant an anonymous caller sending a malformed uuid got a 400 rather than a 401. That
     * 400 is a disclosure: it confirms the route exists and describes its schema, to someone
     * holding no credentials at all. A prober could map the entire API surface without ever
     * presenting a token.
     *
     * `onRequest` is the first hook in the lifecycle, so an unauthenticated request is turned
     * away before Fastify parses, validates, or reveals anything. Caught by a test, which is
     * the only reason it is not still in here.
     */
    protectedRoutes.addHook('onRequest', async (request: FastifyRequest, reply) => {
      const token = bearerToken(request.headers.authorization)

      if (!token) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Bearer token required.' })
      }

      const tenantId = await tenantForToken(db, token)

      if (!tenantId) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid token.' })
      }

      request.tenantId = tenantId
    })

    protectedRoutes.withTypeProvider<ZodTypeProvider>().get('/sites', async (request) => {
      return { sites: await listSites(db, request.tenantId) }
    })

    protectedRoutes.withTypeProvider<ZodTypeProvider>().post(
      '/sites',
      {
        schema: {
          body: z.object({
            url: z.string().url(),
          }),
        },
      },
      async (request, reply) => {
        const { url } = request.body

        const site = await withTenant(db, request.tenantId, async (tx) => {
          const [existing] = await tx
            .select()
            .from(sites)
            .where(and(eq(sites.tenantId, request.tenantId), eq(sites.url, url)))
            .limit(1)

          if (existing) return existing

          const [created] = await tx
            .insert(sites)
            .values({ tenantId: request.tenantId, url })
            .returning()

          return created
        })

        return reply.status(201).send({ site })
      },
    )

    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .get('/audits/:id', { schema: { params: uuidParam } }, async (request, reply) => {
        const audit = await getAudit(db, request.tenantId, request.params.id)

        if (!audit) return notFound(reply)
        return { audit }
      })

    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .get('/findings/:id', { schema: { params: uuidParam } }, async (request, reply) => {
        const finding = await getFinding(db, request.tenantId, request.params.id)

        if (!finding) return notFound(reply)
        return { finding }
      })
  })

  return app
}

/**
 * 404, never 403, for a resource belonging to another tenant.
 *
 * This is the whole difference between "you may not see this" and "this does not exist", and
 * it matters more than it looks. A 403 confirms the row is real: an attacker who can tell
 * 403 from 404 can enumerate which audit ids exist across the whole platform, learn how many
 * customers we have and how active they are, and confirm that a specific competitor is a
 * customer. All without ever reading a single byte of anyone's data.
 *
 * Row-level security makes this natural rather than something to remember: the query simply
 * returns no rows, so the handler cannot tell "not yours" from "not there" either. The code
 * is honest because it genuinely does not know.
 */
const notFound = (reply: { status: (code: number) => { send: (body: unknown) => unknown } }) =>
  reply.status(404).send({ error: 'Not Found' })
