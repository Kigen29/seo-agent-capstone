import { mapsUrlForCid, MapsUrlError, resolveMapsUrl, reviewUrlForPlaceId } from '@seo/connectors'
import { sites, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * The Google Business Profile a site belongs to.
 *
 * One field the client fills in, from one action they already know how to perform: open the
 * business in Maps, press Share, paste the link. Everything else on the local axis is derived
 * from what that link carries, and none of it needs an API key.
 *
 * The resolution happens here rather than in the browser because a short link has to be followed,
 * and following a URL a user supplied is exactly the operation that needs to be constrained to a
 * host allow-list on a server we control. `resolveMapsUrl` does that; this route's job is to
 * translate its refusals into something the person who pasted the link can act on.
 */
export function localRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  /** What is stored, plus the links derived from it, so a caller never rebuilds them. */
  const profileOf = (row: { gbpCid: string | null; gbpPlaceId: string | null }) => ({
    cid: row.gbpCid,
    placeId: row.gbpPlaceId,
    mapsUrl: row.gbpCid ? mapsUrlForCid(row.gbpCid) : null,
    reviewUrl: row.gbpPlaceId ? reviewUrlForPlaceId(row.gbpPlaceId) : null,
  })

  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/sites/:id/business-profile',
      { schema: { params: uuidParam } },
      async (request, reply) => {
        const [site] = await withTenant(db, request.tenantId, (tx) =>
          tx
            .select({ gbpCid: sites.gbpCid, gbpPlaceId: sites.gbpPlaceId })
            .from(sites)
            .where(eq(sites.id, request.params.id))
            .limit(1),
        )
        if (!site) return notFound(reply)

        return profileOf(site)
      },
    )

  /**
   * Connect, or disconnect, a business profile.
   *
   * A null `mapsUrl` clears it, which has to be possible: a client who pasted the wrong branch
   * needs a way back, and a site that stops being local should be able to say so. Anything that
   * resolved to neither identifier is a 400 naming what to do instead, never a silent save of
   * nothing.
   */
  app.withTypeProvider<ZodTypeProvider>().put(
    '/sites/:id/business-profile',
    {
      schema: {
        params: uuidParam,
        body: z.object({ mapsUrl: z.string().max(2048).nullable() }),
      },
    },
    async (request, reply) => {
      const pasted = request.body.mapsUrl?.trim() ?? ''
      let update: { gbpCid: string | null; gbpPlaceId: string | null }

      if (pasted === '') {
        update = { gbpCid: null, gbpPlaceId: null }
      } else {
        try {
          const resolved = await resolveMapsUrl(pasted, deps.options.mapsFetch)
          update = { gbpCid: resolved.cid ?? null, gbpPlaceId: resolved.placeId ?? null }
        } catch (error) {
          // A refusal from the resolver is a fact about the link the user pasted, so it comes
          // back as a 400 carrying its own explanation. Anything else is ours, and rethrows.
          if (error instanceof MapsUrlError) {
            return reply.status(400).send({ error: 'Bad Request', message: error.message })
          }
          throw error
        }
      }

      const [saved] = await withTenant(db, request.tenantId, (tx) =>
        tx
          .update(sites)
          .set(update)
          .where(eq(sites.id, request.params.id))
          .returning({ gbpCid: sites.gbpCid, gbpPlaceId: sites.gbpPlaceId }),
      )

      if (!saved) return notFound(reply)
      return profileOf(saved)
    },
  )
}
