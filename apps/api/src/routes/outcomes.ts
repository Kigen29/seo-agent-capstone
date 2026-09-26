import { listOutcomes } from '@seo/audit'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * Every fix proposed for a site and what became of it: open for review, merged and waiting,
 * verified, or rejected, with the recorded before and after. Scoped by row-level security, so
 * another tenant's site is a 404.
 */
export function outcomeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/sites/:id/outcomes', { schema: { params: uuidParam } }, async (request, reply) => {
      const result = await listOutcomes(db, request.tenantId, request.params.id)
      if (!result) return notFound(reply)
      return result
    })
}
