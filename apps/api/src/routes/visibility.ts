import {
  getVisibilitySettings,
  MAX_COMPETITORS,
  MAX_PROMPTS,
  MAX_PROMPT_LENGTH,
  normaliseCompetitors,
  normalisePrompts,
  saveVisibilitySettings,
  visibilityReport,
} from '@seo/audit'
import { withTenant, sites } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * AI visibility: the prompts we poll, the competitors we compare against, and the report computed
 * live from the checks the poll saga has accumulated.
 */
export function visibilityRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  /**
   * The AI-visibility numbers for a site: citation rate, stability, share of voice.
   *
   * Read live from the poll checks rather than from the last audit, because the saga writes a
   * row a day between audits and a figure frozen at audit time would be stale by design.
   *
   * Its honest states are the point of the axis and are returned rather than error: no prompts
   * configured, prompts configured but never polled, and polling-but-not-enough-yet are three
   * different answers and none of them is a zero.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/sites/:id/visibility/report',
      { schema: { params: uuidParam } },
      async (request, reply) => {
        const [site] = await withTenant(db, request.tenantId, (tx) =>
          tx
            .select({ url: sites.url, competitors: sites.competitors })
            .from(sites)
            .where(eq(sites.id, request.params.id))
            .limit(1),
        )
        if (!site) return notFound(reply)

        return visibilityReport(db, {
          tenantId: request.tenantId,
          siteId: request.params.id,
          domain: site.url,
          competitors: site.competitors,
        })
      },
    )

  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/sites/:id/visibility', { schema: { params: uuidParam } }, async (request, reply) => {
      const settings = await getVisibilitySettings(db, request.tenantId, request.params.id)
      if (!settings) return notFound(reply)
      return settings
    })

  /**
   * Replace the prompts and competitors for a site.
   *
   * The caps are cost ceilings, and they are enforced here rather than trimmed silently: each
   * prompt is a poll a day, on every engine, indefinitely, so a list is a standing subscription
   * and a user who asked for thirty questions deserves to be told they got twenty rather than
   * to discover it later. Tidying that does not change meaning (trimming, collapsing runs of
   * whitespace, dropping a duplicate) happens quietly; anything that would drop a thing the
   * user asked for comes back as a 400 naming it.
   *
   * The save itself is a diff, so adding one question does not reset the history of the others.
   */
  app.withTypeProvider<ZodTypeProvider>().put(
    '/sites/:id/visibility',
    {
      schema: {
        params: uuidParam,
        body: z.object({
          prompts: z.array(z.string().max(MAX_PROMPT_LENGTH)).max(MAX_PROMPTS),
          competitors: z.array(z.string().max(253)).max(MAX_COMPETITORS),
          /** The brand as the press writes it, for the authority axis. Optional. */
          brand: z.string().max(200).nullish(),
        }),
      },
    },
    async (request, reply) => {
      const prompts = normalisePrompts(request.body.prompts)
      const { competitors, invalid } = normaliseCompetitors(request.body.competitors)

      if (invalid.length > 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message:
            `Not a domain: ${invalid.join(', ')}. Competitors are matched by host, so give ` +
            'them as domains, like rivalsafaris.com.',
        })
      }

      const saved = await saveVisibilitySettings(db, request.tenantId, request.params.id, {
        prompts,
        competitors,
        brand: request.body.brand ?? null,
      })

      if (!saved) return notFound(reply)
      return saved
    },
  )
}
