import { hostingConnections, sites, withTenant } from '@seo/db'
import { vercelConsentUrl } from '@seo/vcs'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { signInstallState } from '../github-state.js'
import { connectVercel } from '../hosting-connect.js'
import type { RouteDeps } from '../options.js'
import { notFound } from '../http.js'

const params = z.object({ siteId: z.string().uuid() })

/**
 * One site's own hosting connection (ADR-0028).
 *
 * Three rules hold on every path here. The token is validated before it is stored, against the
 * site URL and repository on our record rather than anything the caller sends. It is stored
 * encrypted and bound to this tenant and site. And it is never returned: status reports the
 * project, not the credential. Another tenant's site is a 404 on every verb (ADR-0009).
 */
export function hostingRoutes(app: FastifyInstance, { db, options }: RouteDeps): void {
  const router = app.withTypeProvider<ZodTypeProvider>()
  router.get('/sites/:siteId/hosting', { schema: { params } }, async (req, reply) => {
    const result = await withTenant(db, req.tenantId, async (tx) => {
      const [site] = await tx.select().from(sites).where(eq(sites.id, req.params.siteId))
      if (!site) return null
      const [connection] = await tx
        .select({
          projectId: hostingConnections.projectId,
          teamId: hostingConnections.teamId,
          origin: hostingConnections.origin,
          repo: hostingConnections.repoFullName,
          validatedAt: hostingConnections.validatedAt,
        })
        .from(hostingConnections)
        .where(eq(hostingConnections.siteId, site.id))
      return {
        // Whether the one-step button can be offered, which depends on the operator.
        oneClick: Boolean(options.vercel),
        mode: connection ? 'vercel' : 'github',
        connection: connection
          ? {
              projectId: connection.projectId,
              teamId: connection.teamId,
              validatedAt: connection.validatedAt,
              needsReconnect:
                connection.origin !== new URL(site.url).origin ||
                connection.repo !== site.repoFullName,
            }
          : null,
      }
    })
    return result ?? notFound(reply)
  })
  router.put(
    '/sites/:siteId/hosting',
    {
      schema: {
        params,
        body: z
          .object({
            token: z.string().min(1).max(4096),
            // Optional: without it the project is found from the site's repository.
            projectId: z
              .string()
              .regex(/^prj_[a-zA-Z0-9]+$/)
              .optional(),
            teamId: z
              .string()
              .regex(/^team_[a-zA-Z0-9]+$/)
              .optional(),
          })
          .strict(),
      },
    },
    async (req, reply) => {
      const [site] = await withTenant(db, req.tenantId, (tx) =>
        tx.select().from(sites).where(eq(sites.id, req.params.siteId)),
      )
      if (!site) return notFound(reply)
      if (!site.repoFullName || !site.githubInstallationId)
        return reply.code(409).send({ message: 'Connect this site’s GitHub repository first.' })

      const result = await connectVercel(
        { db, options },
        req.tenantId,
        {
          id: site.id,
          url: site.url,
          repoFullName: site.repoFullName,
          githubInstallationId: site.githubInstallationId,
        },
        {
          token: req.body.token,
          ...(req.body.projectId ? { projectId: req.body.projectId } : {}),
          ...(req.body.teamId ? { teamId: req.body.teamId } : {}),
        },
      )
      if (result.status === 'connected') return { connected: true, projectId: result.projectId }
      if (result.status === 'changed')
        return reply.code(409).send({ message: 'The site connection changed. Please try again.' })
      return reply.code(422).send({
        message:
          result.status === 'no_project'
            ? `This token can see no Vercel project that deploys ${site.repoFullName}. If the project belongs to a team, add the team ID, or use a token created for that team.`
            : 'Could not confirm this project serves your site from the connected repository. Check the token, team, project ID, and a completed production deployment.',
      })
    },
  )

  /**
   * Begin connecting by consent. Returns Vercel's consent URL for the browser to visit; the state
   * in it is signed for this tenant and this site, so the callback can trust both.
   */
  router.post('/sites/:siteId/hosting/vercel', { schema: { params } }, async (req, reply) => {
    if (!options.vercel)
      return reply.code(503).send({ message: 'Connecting to Vercel in one step is not set up.' })
    const [site] = await withTenant(db, req.tenantId, (tx) =>
      tx.select().from(sites).where(eq(sites.id, req.params.siteId)),
    )
    // Looked up as the caller before signing: a site that is not theirs cannot be named in a
    // state we will honour.
    if (!site) return notFound(reply)
    if (!site.repoFullName || !site.githubInstallationId)
      return reply.code(409).send({ message: 'Connect this site’s GitHub repository first.' })

    const state = signInstallState({ tenantId: req.tenantId, siteId: site.id })
    return { url: vercelConsentUrl(options.vercel, state) }
  })
  router.delete('/sites/:siteId/hosting', { schema: { params } }, async (req, reply) => {
    const found = await withTenant(db, req.tenantId, async (tx) => {
      const [site] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.id, req.params.siteId))
        .for('update')
      if (!site) return false
      await tx.delete(hostingConnections).where(eq(hostingConnections.siteId, site.id))
      return true
    })
    return found ? { connected: false } : notFound(reply)
  })
}
