import { listSites } from '@seo/audit'
import { withTenant, oauthCredentials, sites } from '@seo/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * Everything addressed as a site: listing them, adding one, connecting a repo, and asking for a
 * Search Console property to be verified through that repo.
 */
export function siteRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  app.withTypeProvider<ZodTypeProvider>().get('/sites', async (request) => {
    return { sites: await listSites(db, request.tenantId) }
  })

  app.withTypeProvider<ZodTypeProvider>().post(
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

  /**
   * Open a Search Console auto-verification PR for a site the caller owns. Enqueues the work;
   * the worker creates the property, fetches the token, and opens the PR. Both preconditions
   * are checked here with a clear 409 rather than letting the worker fail obscurely: a repo
   * must be connected (nowhere to open a PR otherwise) and Google must be connected (no token
   * otherwise). A site that is not the caller's is a 404, never a 403.
   */
  app
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

  /**
   * Bind a repository the App can already see to a site the caller owns. The picker sends the
   * chosen repo here. We re-list the tenant's installations and confirm the App genuinely has
   * access to that repo before binding, so a caller cannot name a repository the App cannot
   * touch. A site that is not the caller's is a 404, never a 403.
   */
  app.withTypeProvider<ZodTypeProvider>().post(
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
          .where(and(eq(sites.tenantId, request.tenantId), isNotNull(sites.githubInstallationId))),
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
}
