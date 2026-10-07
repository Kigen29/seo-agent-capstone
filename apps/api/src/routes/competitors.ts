import { competitorWatchReport } from '@seo/audit'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * Competitor watch, read side (ADR-0034).
 *
 * Read only, and it reads only what the weekly sweep has already written. Nothing here fetches a
 * competitor's site: a request to this route must never be a way to make our servers call
 * somebody else's, which is what a "refresh now" button on this page would be.
 */
export function competitorRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/sites/:id/competitor-watch',
      { schema: { params: uuidParam } },
      async (request, reply) => {
        const report = await competitorWatchReport(db, request.tenantId, request.params.id)
        if (!report) return notFound(reply)
        return report
      },
    )
}
