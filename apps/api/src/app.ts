import cors from '@fastify/cors'
import { getAudit, getFinding, listSites } from '@seo/audit'
import {
  buildAuthUrl,
  encryptToken,
  exchangeCode,
  signState,
  verifyState,
  type OAuthConfig,
} from '@seo/connectors'
import { audits, createDb, oauthCredentials, sites, withTenant, type Database } from '@seo/db'
import type { AuditJob } from '@seo/queue'
import { and, eq, sql } from 'drizzle-orm'
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
  /**
   * Puts an audit on the queue and nudges the worker. Injected rather than built here, so the
   * route knows nothing about pg-boss or GitHub, and a test can pass a spy. When absent,
   * `POST /audits` reports 503 rather than creating a queued row that nothing will ever run.
   */
  enqueue?: (job: AuditJob) => Promise<unknown>
  /**
   * Google OAuth. Injected so the connection routes can be tested with a mocked token
   * endpoint, and so the app never reads process.env directly. Absent means the routes report
   * 503 rather than sending users to a half-configured consent screen.
   */
  google?: { config: OAuthConfig; fetch?: typeof globalThis.fetch }
  /** Where the OAuth callback sends the browser when it is done. The web app's origin. */
  webUrl?: string
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

  /**
   * The Google OAuth callback. Unauthenticated on purpose: it is a browser redirect back from
   * Google and carries no bearer token. It cannot be, because the user is mid-consent and has
   * no session on this API.
   *
   * What makes that safe is the signed `state`. It was minted by the authenticated start route
   * for one specific tenant, and `verifyState` refuses anything forged, tampered with, or
   * stale. So the tenant this credential is stored against is one only this server could have
   * named, never one the caller supplied.
   */
  const webUrl = options.webUrl ?? process.env.WEB_URL ?? 'http://localhost:3000'
  const backToDashboard = (status: string) =>
    `${webUrl.replace(/\/$/, '')}/dashboard?google=${status}`

  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query

      // The user declined consent, or Google returned an error. Send them back with a note,
      // not a stack trace: declining is a choice, not a failure.
      if (error || !code || !state) return reply.redirect(backToDashboard('declined'))

      if (!options.google) return reply.redirect(backToDashboard('unavailable'))

      const tenantId = verifyState(state)
      if (!tenantId) return reply.redirect(backToDashboard('invalid'))

      try {
        const tokens = await exchangeCode(options.google.config, code, options.google.fetch)

        // Store the refresh token encrypted, never in the clear (ADR-0003). Upsert, so
        // re-connecting replaces the old grant rather than colliding on (tenant, provider).
        await withTenant(db, tenantId, (tx) =>
          tx
            .insert(oauthCredentials)
            .values({
              tenantId,
              provider: 'google',
              accountEmail: tokens.email,
              refreshTokenEncrypted: encryptToken(tokens.refreshToken),
              scopes: ['webmasters', 'siteverification'],
            })
            .onConflictDoUpdate({
              target: [oauthCredentials.tenantId, oauthCredentials.provider],
              set: {
                accountEmail: tokens.email,
                refreshTokenEncrypted: encryptToken(tokens.refreshToken),
                updatedAt: sql`now()`,
              },
            }),
        )

        return reply.redirect(backToDashboard('connected'))
      } catch (err) {
        // Never leak a token or a Google error detail into a redirect URL, where it would
        // land in browser history and server logs. Log it server-side, send back a generic
        // failure the dashboard can explain.
        console.error('google oauth callback failed', err)
        return reply.redirect(backToDashboard('failed'))
      }
    },
  )

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

    /**
     * Queue an audit for a site the caller owns. Returns immediately with the new audit's id;
     * the crawl runs on the worker, and the dashboard polls the row for live progress.
     */
    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .post(
        '/audits',
        { schema: { body: z.object({ siteId: z.string().uuid() }) } },
        async (request, reply) => {
          // Create the row as `queued` first, so ownership is checked (RLS) and the audit exists
          // before we promise to run it. A site that is not the caller's returns 404, never 403.
          const created = await withTenant(db, request.tenantId, async (tx) => {
            const [site] = await tx
              .select()
              .from(sites)
              .where(eq(sites.id, request.body.siteId))
              .limit(1)

            if (!site) return undefined

            const [audit] = await tx
              .insert(audits)
              .values({ tenantId: request.tenantId, siteId: site.id, status: 'queued' })
              .returning({ id: audits.id })

            return { auditId: audit!.id, seed: site.url }
          })

          if (!created) return notFound(reply)

          if (!options.enqueue) {
            // No queue wired. Do not leave a row stuck on `queued` that nothing will ever run:
            // mark it failed with a reason the dashboard can show.
            await withTenant(db, request.tenantId, (tx) =>
              tx
                .update(audits)
                .set({
                  status: 'failed',
                  error: 'The audit queue is not configured on this server.',
                })
                .where(eq(audits.id, created.auditId)),
            )
            return reply
              .status(503)
              .send({ error: 'Service Unavailable', message: 'The audit queue is not configured.' })
          }

          try {
            await options.enqueue({
              auditId: created.auditId,
              tenantId: request.tenantId,
              siteId: request.body.siteId,
              seed: created.seed,
            })
          } catch (error) {
            // The row exists but the job does not, so the schedule would never pick it up. Mark
            // it failed rather than leave a queued audit that hangs on the dashboard forever.
            await withTenant(db, request.tenantId, (tx) =>
              tx
                .update(audits)
                .set({ status: 'failed', error: 'Could not enqueue the audit. Try again shortly.' })
                .where(eq(audits.id, created.auditId)),
            )
            throw error
          }

          return reply.status(202).send({ auditId: created.auditId })
        },
      )

    /** Whether this tenant has connected Google, and as whom, so the UI can show it. */
    protectedRoutes.withTypeProvider<ZodTypeProvider>().get('/connections', async (request) => {
      const [google] = await withTenant(db, request.tenantId, (tx) =>
        tx
          .select({ email: oauthCredentials.accountEmail })
          .from(oauthCredentials)
          .where(eq(oauthCredentials.provider, 'google'))
          .limit(1),
      )

      return { google: google ? { connected: true, email: google.email } : { connected: false } }
    })

    /**
     * Begin connecting Google. Returns the consent URL for the browser to visit; the state in
     * it is signed for this authenticated tenant, so the eventual callback can trust it.
     */
    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .post('/connections/google', async (request, reply) => {
        if (!options.google) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'Google is not configured.' })
        }

        const state = signState(request.tenantId)
        return { url: buildAuthUrl(options.google.config, state) }
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
