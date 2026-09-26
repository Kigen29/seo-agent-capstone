import { suggestVisibilityPrompts, type SiteContext } from '@seo/agent'
import { summarisePage } from '@seo/audit'
import { countryFromUrl, countryName } from '@seo/core'
import { audits, sites, visibilityPrompts, withTenant } from '@seo/db'
import { NoProviderConfiguredError } from '@seo/llm'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * Draft the questions a site should be tracked on in AI answer engines, so nobody has to write them.
 *
 * Grounded in what the product already knows: the homepage's own title, description and headings
 * (fetched through the SSRF guard), the topic clusters from the latest audit, the market its domain
 * points at, and the questions already tracked. One budget-guarded model call. Nothing is saved:
 * the person ticks what to track, and the existing save does the rest.
 */
export function promptSuggestionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  app
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/sites/:id/visibility/suggestions',
      { schema: { params: uuidParam } },
      async (request, reply) => {
        const unavailable = () =>
          reply.status(503).send({
            error: 'Service Unavailable',
            message:
              'Suggestions need a model, and none is configured. Add an OpenAI key (LLM_SMART) ' +
              'and a monthly budget, then try again.',
          })
        if (!options.outreach) return unavailable()

        // Ownership first, through RLS, so another tenant's site is a 404 and never a billed call.
        const context = await withTenant(db, request.tenantId, async (tx) => {
          const [site] = await tx
            .select({ url: sites.url, brand: sites.brand })
            .from(sites)
            .where(eq(sites.id, request.params.id))
            .limit(1)
          if (!site) return undefined
          const [latest] = await tx
            .select({ metrics: audits.metrics })
            .from(audits)
            .where(
              and(
                eq(audits.siteId, request.params.id),
                eq(audits.status, 'complete'),
                isNotNull(audits.metrics),
              ),
            )
            .orderBy(desc(audits.completedAt))
            .limit(1)
          const tracked = await tx
            .select({ prompt: visibilityPrompts.prompt })
            .from(visibilityPrompts)
            .where(eq(visibilityPrompts.siteId, request.params.id))
          return { site, topics: latest?.metrics?.topics, tracked }
        })
        if (!context) return notFound(reply)

        const llm = options.outreach(request.tenantId, db)
        if (!llm) return unavailable()

        const page = await summarisePage(context.site.url, {
          ...(options.checkFetch ? { fetch: options.checkFetch } : {}),
          ...(options.checkResolve ? { resolve: options.checkResolve } : {}),
        })
        const market = countryFromUrl(context.site.url)
        const site: SiteContext = {
          url: context.site.url,
          ...(market ? { country: countryName(market) } : {}),
          title: page?.title ?? null,
          description: page?.description ?? null,
          headings: page?.headings ?? [],
          topics: (context.topics?.clusters ?? []).map((cluster) => cluster.name).filter(Boolean),
          brand: context.site.brand,
          existing: context.tracked.map((row) => row.prompt),
        }

        try {
          const suggestions = await suggestVisibilityPrompts(llm, request.tenantId, site)
          return {
            suggestions,
            ...(page
              ? {}
              : {
                  note: 'The homepage could not be read, so these are drafted from the site address and its audit alone.',
                }),
          }
        } catch (error) {
          if (error instanceof NoProviderConfiguredError) return unavailable()
          const message = error instanceof Error ? error.message : String(error)
          if (message.startsWith('Budget guard:')) {
            return reply.status(429).send({
              error: 'Too Many Requests',
              message:
                'This account has used its monthly budget for paid features, so no suggestions ' +
                'were drafted. The cap is shown under Settings, Account.',
            })
          }
          request.log.warn({ err: message }, 'prompt suggestions failed')
          return reply.status(502).send({
            error: 'Bad Gateway',
            message:
              'The model did not answer. Nothing was charged beyond what it used; try again.',
          })
        }
      },
    )
}
