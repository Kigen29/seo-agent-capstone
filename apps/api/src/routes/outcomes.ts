import { listOutcomes } from '@seo/audit'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'
import { refreshWaitingPullRequest } from '../pr-refresh.js'

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

      // The page that answers "what became of each fix" must not be the last to hear of a merge.
      // A handful at most: each is one bounded request, and a site rarely has more waiting.
      const waiting = result.outcomes.filter((outcome) => outcome.status === 'pr_open').slice(0, 5)
      const changed = await Promise.all(
        waiting.map((outcome) =>
          refreshWaitingPullRequest(
            deps,
            request.tenantId,
            { ...outcome, siteId: request.params.id },
            request.log,
          ),
        ),
      )
      if (changed.some(Boolean)) {
        return (await listOutcomes(db, request.tenantId, request.params.id)) ?? result
      }
      return result
    })
}
