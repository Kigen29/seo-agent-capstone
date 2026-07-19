import cors from '@fastify/cors'
import { getAudit, getFinding, listFindings, listSites } from '@seo/audit'
import {
  buildAuthUrl,
  encryptToken,
  exchangeCode,
  signState,
  verifyState,
  type OAuthConfig,
} from '@seo/connectors'
import {
  asOwner,
  audits,
  createDb,
  findings,
  oauthCredentials,
  sites,
  withTenant,
  type Database,
} from '@seo/db'
import type { AuditJob, ConfirmVerifyJob, FixJob, VerifyFixJob, VerifyJob } from '@seo/queue'
import {
  SIGNATURE_HEADER,
  verifyWebhookSignature,
  type GitHubApp,
  type InstalledRepo,
} from '@seo/vcs'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { bearerToken, tenantForToken } from './auth.js'
import { signInstallState, verifyInstallState } from './github-state.js'

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
   * Puts a verification-PR job on the queue and nudges the worker. Injected like `enqueue`.
   * Absent means `POST /sites/:id/verify` reports 503 rather than accepting work nothing runs.
   */
  enqueueVerify?: (job: VerifyJob) => Promise<unknown>
  /**
   * Puts a confirm-verification job on the queue when a verification PR is merged. Injected like
   * the others; absent means the webhook still acknowledges the merge but does not auto-confirm.
   */
  enqueueConfirmVerify?: (job: ConfirmVerifyJob) => Promise<unknown>
  /**
   * Puts a fix-PR job on the queue and nudges the worker. Injected like the others; absent means
   * `POST /findings/:id/fix` reports 503 rather than accepting work nothing will run.
   */
  enqueueFix?: (job: FixJob) => Promise<unknown>
  /**
   * Puts a verify-fix job on the queue when a fix PR is merged. Injected like the others; absent
   * means the webhook still marks the finding merged but does not auto-verify it.
   */
  enqueueVerifyFix?: (job: VerifyFixJob) => Promise<unknown>
  /**
   * Google OAuth. Injected so the connection routes can be tested with a mocked token
   * endpoint, and so the app never reads process.env directly. Absent means the routes report
   * 503 rather than sending users to a half-configured consent screen.
   */
  google?: { config: OAuthConfig; fetch?: typeof globalThis.fetch }
  /**
   * The GitHub App (ADR-0002). Injected, like Google, so the connect and webhook routes can be
   * tested with a fake app and a known secret, and so the API never reads the App credentials
   * from process.env directly. Absent means those routes report 503 rather than pretend.
   */
  github?: {
    app: GitHubApp
    /** The App's URL slug, for building the install link `github.com/apps/<slug>`. */
    slug: string
    /** The secret GitHub signs each webhook with, so we can prove a delivery is genuine. */
    webhookSecret: string
  }
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
    /** The exact bytes of a webhook body, kept so its HMAC signature can be verified. */
    rawBody?: string
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
  const backToDashboardGithub = (status: string) =>
    `${webUrl.replace(/\/$/, '')}/dashboard?github=${status}`

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

  /**
   * The GitHub App setup callback. Unauthenticated for the same reason as the Google one: it is
   * a browser redirect back from GitHub after the user installs the App, carrying an
   * `installation_id` and our signed `state`, but no session on this API.
   *
   * The state is what makes it safe. It was signed for one tenant and one site by the
   * authenticated start route, so the installation is written onto a site the caller genuinely
   * owns, never one an unsigned parameter named.
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/connections/github/callback',
    {
      schema: {
        querystring: z.object({
          installation_id: z.coerce.number().optional(),
          setup_action: z.string().optional(),
          state: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { installation_id: installationId, state } = request.query

      if (!state || !installationId) return reply.redirect(backToDashboardGithub('declined'))
      if (!options.github) return reply.redirect(backToDashboardGithub('unavailable'))

      const verified = verifyInstallState(state)
      if (!verified) return reply.redirect(backToDashboardGithub('invalid'))
      const { tenantId, siteId } = verified

      try {
        const site = await withTenant(db, tenantId, async (tx) => {
          const [row] = await tx.select().from(sites).where(eq(sites.id, siteId)).limit(1)
          return row
        })
        if (!site) return reply.redirect(backToDashboardGithub('invalid'))

        // Which repo does this installation actually grant? Resolve it, and match it to the
        // site the user started from, so the fixer knows exactly which repo to open a PR against.
        const repos = await options.github.app.listInstallationRepositories(installationId)
        if (repos.length === 0) return reply.redirect(backToDashboardGithub('norepo'))

        const chosen = chooseRepoForSite(repos, site.url)

        await withTenant(db, tenantId, (tx) =>
          tx
            .update(sites)
            .set({ repoFullName: chosen.fullName, githubInstallationId: installationId })
            .where(eq(sites.id, siteId)),
        )

        return reply.redirect(backToDashboardGithub('connected'))
      } catch (err) {
        console.error('github install callback failed', err)
        return reply.redirect(backToDashboardGithub('failed'))
      }
    },
  )

  /**
   * The webhook GitHub calls when an installation changes or a pull request moves.
   *
   * Registered as its own plugin so it can keep the raw request body: GitHub signs the exact
   * bytes it sent, and re-serialising a parsed object would not reproduce them, so the HMAC
   * would never match. The content-type parser here is scoped to this plugin; the rest of the
   * API keeps Fastify's default JSON handling.
   */
  await app.register(async (webhookRoutes) => {
    webhookRoutes.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (req, body, done) => {
        req.rawBody = typeof body === 'string' ? body : body.toString('utf8')
        try {
          done(null, req.rawBody === '' ? {} : JSON.parse(req.rawBody))
        } catch (err) {
          done(err as Error, undefined)
        }
      },
    )

    webhookRoutes.post('/webhooks/github', async (request, reply) => {
      if (!options.github) {
        return reply
          .status(503)
          .send({ error: 'Service Unavailable', message: 'GitHub is not configured.' })
      }

      const signature = request.headers[SIGNATURE_HEADER]
      const ok = verifyWebhookSignature(
        options.github.webhookSecret,
        request.rawBody ?? '',
        typeof signature === 'string' ? signature : undefined,
      )
      if (!ok) {
        // Anyone can POST to a public URL; only GitHub can sign. An unverified delivery is
        // turned away before a single field of it is read.
        return reply.status(401).send({ error: 'Unauthorized', message: 'Bad signature.' })
      }

      const event = request.headers['x-github-event']
      const payload = request.body as GithubWebhookPayload

      if (
        event === 'installation' &&
        (payload.action === 'deleted' || payload.action === 'suspend')
      ) {
        // The App was removed or suspended: no site under this installation can be fixed any
        // more, so clear the link. asOwner because a webhook carries no tenant context, and the
        // installation id spans whatever sites, in whatever tenants, were connected through it.
        const installationId = payload.installation?.id
        if (installationId) {
          await asOwner(db, (tx) =>
            tx
              .update(sites)
              .set({ githubInstallationId: null, repoFullName: null })
              .where(eq(sites.githubInstallationId, installationId)),
          )
        }
      }

      // A verification PR closing drives the site's status. The webhook has no tenant context,
      // so the site (and its tenant) is looked up from the branch name; asOwner because there is
      // no request tenant to scope by here.
      //
      //   merged -> mark merged, and enqueue a confirm job that asks Google to check (retrying
      //             while the deploy lands).
      //   closed -> if a PR was open, reset to none so the dashboard offers Verify again.
      if (event === 'pull_request' && payload.action === 'closed') {
        const ref = payload.pull_request?.head?.ref ?? ''
        const match = ref.match(
          /^seo-agent\/AGENT-VERIFY-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i,
        )
        if (match) {
          const siteId = match[1]!
          const [site] = await asOwner(db, (tx) =>
            tx
              .select({ tenantId: sites.tenantId, status: sites.gscVerificationStatus })
              .from(sites)
              .where(eq(sites.id, siteId))
              .limit(1),
          )

          if (site && payload.pull_request?.merged) {
            await asOwner(db, (tx) =>
              tx.update(sites).set({ gscVerificationStatus: 'merged' }).where(eq(sites.id, siteId)),
            )
            if (options.enqueueConfirmVerify) {
              await options.enqueueConfirmVerify({ tenantId: site.tenantId, siteId })
            }
          } else if (site && site.status === 'pr_open') {
            // Closed without merging: undo, so a fresh Verify can start cleanly.
            await asOwner(db, (tx) =>
              tx
                .update(sites)
                .set({ gscVerificationStatus: 'none', gscVerificationPrUrl: null })
                .where(eq(sites.id, siteId)),
            )
          }
        }

        // A fix PR closing drives its finding's status. The finding is matched by the PR URL we
        // stored when we opened it, which is exact where a branch name is not (a rule key is only
        // unique within an audit). asOwner because a webhook carries no tenant context.
        //
        //   merged -> mark merged, and enqueue a re-audit that verifies whether the fix held.
        //   closed -> if a PR was open, reset to open so the finding can be fixed again.
        const prUrl = payload.pull_request?.html_url
        if (prUrl) {
          const [finding] = await asOwner(db, (tx) =>
            tx
              .select({
                id: findings.id,
                tenantId: findings.tenantId,
                siteId: findings.siteId,
                status: findings.status,
              })
              .from(findings)
              .where(eq(findings.prUrl, prUrl))
              .limit(1),
          )

          if (finding && payload.pull_request?.merged) {
            await asOwner(db, (tx) =>
              tx.update(findings).set({ status: 'merged' }).where(eq(findings.id, finding.id)),
            )
            if (options.enqueueVerifyFix) {
              await options.enqueueVerifyFix({ tenantId: finding.tenantId, siteId: finding.siteId })
            }
          } else if (finding && finding.status === 'pr_open') {
            // Closed without merging: undo, so the finding can be fixed again cleanly.
            await asOwner(db, (tx) =>
              tx
                .update(findings)
                .set({ status: 'open', prUrl: null })
                .where(eq(findings.id, finding.id)),
            )
          }
        }
      }

      return reply.status(204).send()
    })
  })

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

    /** The findings inbox: the tenant's current findings, most important first. */
    protectedRoutes.withTypeProvider<ZodTypeProvider>().get('/findings', async (request) => {
      return { findings: await listFindings(db, request.tenantId) }
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
     * Open a pull request that fixes a finding the caller owns. Enqueues the work; the worker
     * detects the framework, generates the diff, and opens the PR, then marks the finding
     * `pr_open` with the PR URL. The preconditions are checked here with a clear 409 rather than
     * letting the worker fail obscurely: the finding must be fixable in code, it must not already
     * have a PR open (or merged), and its site must have a repository connected. A finding that is
     * not the caller's is a 404, never a 403.
     */
    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .post('/findings/:id/fix', { schema: { params: uuidParam } }, async (request, reply) => {
        if (!options.enqueueFix) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'The fixer is not configured.' })
        }

        const finding = await getFinding(db, request.tenantId, request.params.id)
        if (!finding) return notFound(reply)

        if (!finding.fixable) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'This finding cannot be fixed in code automatically; it needs a human.',
          })
        }
        if (finding.status !== 'open') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'A pull request for this finding has already been opened.',
          })
        }

        const [site] = await withTenant(db, request.tenantId, (tx) =>
          tx
            .select({ repo: sites.repoFullName, installation: sites.githubInstallationId })
            .from(sites)
            .where(eq(sites.id, finding.siteId))
            .limit(1),
        )
        if (!site || !site.repo || !site.installation) {
          return reply
            .status(409)
            .send({ error: 'Conflict', message: 'Connect a repository to this site first.' })
        }

        await options.enqueueFix({
          tenantId: request.tenantId,
          siteId: finding.siteId,
          findingRowId: finding.rowId,
        })
        return reply.status(202).send({ status: 'queued' })
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

    /**
     * Open a Search Console auto-verification PR for a site the caller owns. Enqueues the work;
     * the worker creates the property, fetches the token, and opens the PR. Both preconditions
     * are checked here with a clear 409 rather than letting the worker fail obscurely: a repo
     * must be connected (nowhere to open a PR otherwise) and Google must be connected (no token
     * otherwise). A site that is not the caller's is a 404, never a 403.
     */
    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .post('/sites/:id/verify', { schema: { params: uuidParam } }, async (request, reply) => {
        if (!options.enqueueVerify) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'Verification is not configured.' })
        }

        const site = await withTenant(db, request.tenantId, async (tx) => {
          const [row] = await tx
            .select({
              id: sites.id,
              repo: sites.repoFullName,
              installation: sites.githubInstallationId,
              status: sites.gscVerificationStatus,
            })
            .from(sites)
            .where(eq(sites.id, request.params.id))
            .limit(1)
          return row
        })
        if (!site) return notFound(reply)

        if (!site.repo || !site.installation) {
          return reply
            .status(409)
            .send({ error: 'Conflict', message: 'Connect a repository to this site first.' })
        }

        // One verification at a time. A repeat click while a PR is open, merged, or the site is
        // already verified is a 409 with the reason, not a second PR.
        if (site.status === 'verified') {
          return reply
            .status(409)
            .send({ error: 'Conflict', message: 'This site is already verified.' })
        }
        if (site.status === 'pr_open') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'A verification PR is already open. Review and merge it.',
          })
        }
        if (site.status === 'merged') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'The verification PR is merged; waiting for Google to confirm.',
          })
        }

        const [google] = await withTenant(db, request.tenantId, (tx) =>
          tx
            .select({ id: oauthCredentials.id })
            .from(oauthCredentials)
            .where(eq(oauthCredentials.provider, 'google'))
            .limit(1),
        )
        if (!google) {
          return reply
            .status(409)
            .send({ error: 'Conflict', message: 'Connect Google Search Console first.' })
        }

        await options.enqueueVerify({ tenantId: request.tenantId, siteId: site.id })
        return reply.status(202).send({ status: 'queued' })
      })

    /** What this tenant has connected, so the UI can show it: Google, and any connected repos. */
    protectedRoutes.withTypeProvider<ZodTypeProvider>().get('/connections', async (request) => {
      const [google] = await withTenant(db, request.tenantId, (tx) =>
        tx
          .select({ email: oauthCredentials.accountEmail })
          .from(oauthCredentials)
          .where(eq(oauthCredentials.provider, 'google'))
          .limit(1),
      )

      const connectedRepos = await withTenant(db, request.tenantId, (tx) =>
        tx
          .select({ repoFullName: sites.repoFullName })
          .from(sites)
          .where(isNotNull(sites.githubInstallationId)),
      )
      const repos = connectedRepos
        .map((row) => row.repoFullName)
        .filter((name): name is string => Boolean(name))

      return {
        google: google ? { connected: true, email: google.email } : { connected: false },
        github: { connected: repos.length > 0, repos },
      }
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

    /**
     * Begin connecting a repository to a site the caller owns. Returns the GitHub App install
     * URL; the state in it is signed for this tenant and this site, so the setup callback can
     * write the resulting installation onto the right site and no other.
     */
    protectedRoutes
      .withTypeProvider<ZodTypeProvider>()
      .post(
        '/connections/github',
        { schema: { body: z.object({ siteId: z.string().uuid() }) } },
        async (request, reply) => {
          if (!options.github) {
            return reply
              .status(503)
              .send({ error: 'Service Unavailable', message: 'GitHub is not configured.' })
          }

          // Confirm the site is the caller's first (404, never 403, for someone else's), then
          // sign the state. A site that is not theirs cannot be named in a state we will honour.
          const site = await withTenant(db, request.tenantId, async (tx) => {
            const [row] = await tx
              .select({ id: sites.id, url: sites.url })
              .from(sites)
              .where(eq(sites.id, request.body.siteId))
              .limit(1)
            return row
          })
          if (!site) return notFound(reply)

          /**
           * Two ways to begin, because the App is installed once per tenant, not once per site.
           *
           * The FIRST repo is a fresh install: GitHub carries our signed `state` through it, and the
           * setup callback binds the repo. Every repo AFTER that must not re-install, because once
           * the App is installed GitHub runs a "configure" flow that drops the query string, so the
           * callback sees no state and the whole thing looks like a cancelled install ("The install
           * was cancelled. Nothing was connected."). So when the tenant already has an installation,
           * we do not guess a repo from the site's name (a repo can be named anything); we hand back
           * the repositories the App can see and let the user pick.
           */
          const installedRows = await withTenant(db, request.tenantId, (tx) =>
            tx
              .selectDistinct({ installationId: sites.githubInstallationId })
              .from(sites)
              .where(
                and(eq(sites.tenantId, request.tenantId), isNotNull(sites.githubInstallationId)),
              ),
          )
          const installationIds = installedRows
            .map((row) => row.installationId)
            .filter((id): id is number => id !== null)

          if (installationIds.length > 0) {
            const seen = new Set<string>()
            const repos: { fullName: string; installationId: number }[] = []
            for (const installationId of installationIds) {
              for (const repo of await options.github.app.listInstallationRepositories(
                installationId,
              )) {
                if (seen.has(repo.fullName)) continue
                seen.add(repo.fullName)
                repos.push({ fullName: repo.fullName, installationId })
              }
            }
            return {
              mode: 'pick' as const,
              repos,
              // Where the user grants access to a repo the App cannot see yet.
              manageUrl: `https://github.com/settings/installations/${installationIds[0]}`,
            }
          }

          const state = signInstallState({
            tenantId: request.tenantId,
            siteId: request.body.siteId,
          })
          // `select_target`, not `new`. GitHub drops the query string when it 302s `new` to
          // `select_target`, so a state passed to `new` never reaches our setup URL and the
          // callback has no tenant or site to bind to. Linking straight to `select_target`
          // preserves the state through to the redirect. This is a known GitHub behaviour.
          const url =
            `https://github.com/apps/${options.github.slug}/installations/select_target` +
            `?state=${encodeURIComponent(state)}`
          return { mode: 'install' as const, url }
        },
      )

    /**
     * Bind a repository the App can already see to a site the caller owns. The picker sends the
     * chosen repo here. We re-list the tenant's installations and confirm the App genuinely has
     * access to that repo before binding, so a caller cannot name a repository the App cannot
     * touch. A site that is not the caller's is a 404, never a 403.
     */
    protectedRoutes.withTypeProvider<ZodTypeProvider>().post(
      '/sites/:id/repo',
      {
        schema: {
          params: uuidParam,
          body: z.object({ repoFullName: z.string().min(1) }),
        },
      },
      async (request, reply) => {
        if (!options.github) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'GitHub is not configured.' })
        }

        const [site] = await withTenant(db, request.tenantId, (tx) =>
          tx.select({ id: sites.id }).from(sites).where(eq(sites.id, request.params.id)).limit(1),
        )
        if (!site) return notFound(reply)

        const installedRows = await withTenant(db, request.tenantId, (tx) =>
          tx
            .selectDistinct({ installationId: sites.githubInstallationId })
            .from(sites)
            .where(
              and(eq(sites.tenantId, request.tenantId), isNotNull(sites.githubInstallationId)),
            ),
        )
        const installationIds = installedRows
          .map((row) => row.installationId)
          .filter((id): id is number => id !== null)

        for (const installationId of installationIds) {
          const repos = await options.github.app.listInstallationRepositories(installationId)
          if (repos.some((repo) => repo.fullName === request.body.repoFullName)) {
            await withTenant(db, request.tenantId, (tx) =>
              tx
                .update(sites)
                .set({
                  repoFullName: request.body.repoFullName,
                  githubInstallationId: installationId,
                })
                .where(eq(sites.id, request.params.id)),
            )
            return { repoFullName: request.body.repoFullName }
          }
        }

        return reply.status(409).send({
          error: 'Conflict',
          message: 'The app cannot access that repository. Grant it access on GitHub, then retry.',
        })
      },
    )
  })

  return app
}

/**
 * Pick which of an installation's repositories to connect to a site.
 *
 * A one-repo installation is unambiguous. When several were granted, prefer the repo whose name
 * matches the site's domain stem (heartbeestsafaris.com -> a repo named "heartbeestsafaris"),
 * then any repo whose name contains it, and fall back to the first. The user can reconnect to
 * correct a wrong guess; the point is to not fail when the match is obvious.
 */
/**
 * The repo in an installation that belongs to a site, or null when none clearly does.
 *
 * Matches on the site's domain stem against the repo name, comparing both with punctuation
 * removed, so `lakevictoriaaquaculture.com` matches a repo named `lake-victoria-aquaculture`.
 * Exact first, then either name being a substring of the other. Returns null rather than guess:
 * the reuse-an-installation path must not bind the wrong repo to a site, so a non-match is sent to
 * GitHub to grant the right repo instead.
 */
function matchRepoForSite(repos: InstalledRepo[], siteUrl: string): InstalledRepo | null {
  let stem = ''
  try {
    stem = normaliseName(new URL(siteUrl).hostname.replace(/^www\./, '').split('.')[0] ?? '')
  } catch {
    return null
  }
  if (!stem) return null

  const exact = repos.find((repo) => normaliseName(repo.name) === stem)
  if (exact) return exact

  // A substring match only for names distinctive enough to trust it. A one or two character stem
  // ("a.com", "app.io" -> "app") would otherwise match almost any repo, so short names get an
  // exact match only.
  const MIN_PARTIAL = 4
  if (stem.length < MIN_PARTIAL) return null

  return (
    repos.find((repo) => {
      const name = normaliseName(repo.name)
      return name.includes(stem) || (name.length >= MIN_PARTIAL && stem.includes(name))
    }) ?? null
  )
}

const normaliseName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Pick which of a fresh install's granted repositories to connect to a site.
 *
 * Used by the install callback, where the user has explicitly granted a set of repos, so a
 * fall-back to the first is reasonable when no name matches. The stricter {@link matchRepoForSite}
 * is used on the reuse path, where guessing would silently bind the wrong repo.
 */
function chooseRepoForSite(repos: InstalledRepo[], siteUrl: string): InstalledRepo {
  if (repos.length === 1) return repos[0]!
  return matchRepoForSite(repos, siteUrl) ?? repos[0]!
}

/** The slice of a GitHub webhook body we actually read. The rest is ignored on purpose. */
interface GithubWebhookPayload {
  action?: string
  installation?: { id?: number }
  pull_request?: { merged?: boolean; head?: { ref?: string }; html_url?: string }
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
