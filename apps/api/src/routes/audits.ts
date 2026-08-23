import { getAudit, getAuditProgress } from '@seo/audit'
import { withTenant, audits, sites } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/** Starting a crawl, and the two ways of watching one: the whole audit, and just its progress. */
export function auditRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/audits/:id', { schema: { params: uuidParam } }, async (request, reply) => {
      const audit = await getAudit(db, request.tenantId, request.params.id)

      if (!audit) return notFound(reply)
      return { audit }
    })

  /**
   * Two scalars, for the poll that runs every two seconds while a crawl is in flight.
   *
   * The audit page was polling `GET /audits/:id`, which returns every finding with its full
   * evidence, baseline and verification JSON, to read a status and a page count. On a large
   * crawl that is megabytes re-serialised twice a minute per open tab.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/audits/:id/progress', { schema: { params: uuidParam } }, async (request, reply) => {
      const progress = await getAuditProgress(db, request.tenantId, request.params.id)

      if (!progress) return notFound(reply)
      return progress
    })

  /**
   * Queue an audit for a site the caller owns. Returns immediately with the new audit's id;
   * the crawl runs on the worker, and the dashboard polls the row for live progress.
   */
  app
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
}
