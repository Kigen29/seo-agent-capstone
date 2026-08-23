import cors from '@fastify/cors'
import { createDb } from '@seo/db'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { bearerToken, tenantForToken } from './auth.js'
import type { AppOptions, RouteDeps } from './options.js'
import { auditRoutes } from './routes/audits.js'
import { connectionRoutes } from './routes/connections.js'
import { findingRoutes } from './routes/findings.js'
import { keywordRoutes } from './routes/keywords.js'
import { oauthCallbackRoutes } from './routes/oauth-callbacks.js'
import { siteRoutes } from './routes/sites.js'
import { visibilityRoutes } from './routes/visibility.js'
import { githubWebhookRoutes } from './routes/webhooks.js'

/**
 * Re-exported so callers keep importing it from here.
 *
 * It moved to `options.ts` because every route module needs it and importing it from `app.ts`
 * would have made every module a cycle: app imports the routes, the routes import app.
 */
export type { AppOptions } from './options.js'

/**
 * Wire the API together.
 *
 * This file used to be twelve hundred lines and every route in the product, which is the god
 * module rule 9 exists to forbid. It is now the assembly: error handling, the authentication
 * gate, and the order things are registered in. Each route module owns one resource and can be
 * read without scrolling past four others.
 *
 * The shape that matters is the two scopes. Everything inside the second `register` is behind the
 * `onRequest` token check, and route modules are *called* rather than registered so they stay in
 * that scope and inherit the hook. A module cannot opt out of authentication by accident: it has
 * no way to reach the root instance.
 */
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

  const deps: RouteDeps = {
    db,
    options,
    webUrl: options.webUrl ?? process.env.WEB_URL ?? 'http://localhost:3000',
  }

  // Unauthenticated on purpose, and each says why in its own file.
  oauthCallbackRoutes(app, deps)
  await githubWebhookRoutes(app, deps)

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

    siteRoutes(protectedRoutes, deps)
    findingRoutes(protectedRoutes, deps)
    auditRoutes(protectedRoutes, deps)
    connectionRoutes(protectedRoutes, deps)
    keywordRoutes(protectedRoutes, deps)
    visibilityRoutes(protectedRoutes, deps)
  })

  return app
}
