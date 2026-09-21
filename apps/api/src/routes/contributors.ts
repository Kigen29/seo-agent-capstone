import { findContributors, SerpBudgetError } from '@seo/connectors'
import { sites, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * Places that might publish this client.
 *
 * Mention building rather than link building, which is the framing ADR-0018's evidence supports
 * and the framing rule 7 requires: branded mentions correlate 0.664 with AI Overview visibility
 * against 0.218 for backlinks, and a list of sites presented as link targets is a list of link
 * schemes waiting to happen.
 *
 * A POST, not a GET, and that is not pedantry about verbs. Each call runs billed searches and
 * fetches a dozen pages, so it must not be something a browser does on its own when somebody
 * opens a page, a prefetcher warms a link, or a crawler follows one.
 */
export function contributorRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  app.withTypeProvider<ZodTypeProvider>().post(
    '/sites/:id/contributors',
    {
      schema: {
        params: uuidParam,
        body: z.object({
          /** What the client does, in the words a publication would use. */
          niche: z.string().min(3).max(120),
          /** A market word for the searches, e.g. 'Kenya'. */
          locale: z.string().max(60).optional(),
          country: z.string().min(2).max(2).optional(),
        }),
      },
    },
    async (request, reply) => {
      const [site] = await withTenant(db, request.tenantId, (tx) =>
        tx.select({ url: sites.url }).from(sites).where(eq(sites.id, request.params.id)).limit(1),
      )
      if (!site) return notFound(reply)

      const serp = options.serp?.(request.tenantId, db)
      if (!serp) {
        return {
          niche: request.body.niche,
          opportunities: [],
          refused: [],
          queriesRun: 0,
          note:
            'This needs a SERP data source, which is off by default (set SERPAPI_API_KEY). No ' +
            'search is not the same as no opportunities, so this is empty rather than zero.',
        }
      }

      try {
        return await findContributors(serp, {
          niche: request.body.niche,
          clientDomain: site.url,
          /*
            The same injected transport the anonymous check uses, and for the same reason: this
            reads pages we did not author, through the SSRF guard, and a test must be able to
            drive it without fetching somebody's real site.
          */
          fetchOptions: {
            ...(options.checkFetch ? { fetch: options.checkFetch } : {}),
            ...(options.checkResolve ? { resolve: options.checkResolve } : {}),
          },
          ...(request.body.locale ? { locale: request.body.locale } : {}),
          ...(request.body.country ? { country: request.body.country } : {}),
        })
      } catch (error) {
        if (error instanceof SerpBudgetError) {
          return reply.status(429).send({
            error: 'Too Many Requests',
            message: `${error.message}. The cap resets at the start of next calendar month.`,
          })
        }
        throw error
      }
    },
  )
}
