import { encryptToken } from '@seo/connectors'
import { hostingConnections, sites, withTenant } from '@seo/db'
import { createVercelDeploymentLookup } from '@seo/vcs'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
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
            projectId: z.string().regex(/^prj_[a-zA-Z0-9]+$/),
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
      const input = {
        ...req.body,
        siteUrl: site.url,
        repoFullName: site.repoFullName,
        installationId: site.githubInstallationId,
      }
      let valid = false
      try {
        if (options.validateHosting) valid = await options.validateHosting(input)
        else if (options.github) {
          const [owner, name] = site.repoFullName.split('/')
          const api = await options.github.app.apiFor({
            repo: { owner: owner!, name: name! },
            installationId: site.githubInstallationId,
          })
          const repoId = await api.getRepositoryId?.()
          if (repoId)
            valid =
              (await createVercelDeploymentLookup(input)(site.url, repoId)).status === 'confirmed'
        }
      } catch {
        /* Never log credentials or upstream response bodies. */
      }
      if (!valid)
        return reply.code(422).send({
          message:
            'Could not confirm this project serves your site from the connected repository. Check the token, team, project ID, and a completed production deployment.',
        })
      const tokenEncrypted = encryptToken(
        JSON.stringify({ tenantId: req.tenantId, siteId: site.id, token: req.body.token }),
      )
      const saved = await withTenant(db, req.tenantId, async (tx) => {
        const [current] = await tx.select().from(sites).where(eq(sites.id, site.id)).for('update')
        if (
          !current ||
          current.url !== site.url ||
          current.repoFullName !== site.repoFullName ||
          current.githubInstallationId !== site.githubInstallationId
        )
          return false
        const value = {
          siteId: site.id,
          tenantId: req.tenantId,
          revision: randomUUID(),
          origin: new URL(site.url).origin,
          repoFullName: site.repoFullName!,
          projectId: req.body.projectId,
          teamId: req.body.teamId ?? null,
          tokenEncrypted,
          validatedAt: new Date(),
        }
        await tx
          .insert(hostingConnections)
          .values(value)
          .onConflictDoUpdate({ target: hostingConnections.siteId, set: value })
        return true
      })
      if (!saved)
        return reply.code(409).send({ message: 'The site connection changed. Please try again.' })
      return { connected: true }
    },
  )
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
