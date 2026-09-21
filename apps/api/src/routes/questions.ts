import { openSearchConsole } from '@seo/audit'
import {
  DEFAULT_QUESTION_LIMIT,
  defaultWindow,
  mineQuestions,
  SerpBudgetError,
} from '@seo/connectors'
import { sites, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * The questions a site's customers actually ask.
 *
 * Two sources with different costs and different standing, and the route keeps them apart rather
 * than blending them into one list of suggestions:
 *
 *   - **Search Console**, free, and the stronger of the two: questions this site is already being
 *     shown for. It runs whenever Google is connected, with no seed and no spend.
 *   - **People Also Ask**, one paid query, and only when the caller supplies a seed. It is what
 *     Google offers alongside a subject, which is demand observed somewhere rather than demand
 *     this site receives.
 *
 * Neither is a model's guess about what people might ask, which is what the free tools in this
 * category return.
 */
export function questionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  app.withTypeProvider<ZodTypeProvider>().get(
    '/sites/:id/questions',
    {
      schema: {
        params: uuidParam,
        querystring: z.object({
          /** A subject to ask Google about. Without it, only the free half runs. */
          seed: z.string().min(2).max(200).optional(),
          country: z.string().min(2).max(2).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
    },
    async (request, reply) => {
      const [site] = await withTenant(db, request.tenantId, (tx) =>
        tx
          .select({ url: sites.url, gscProperty: sites.gscProperty })
          .from(sites)
          .where(eq(sites.id, request.params.id))
          .limit(1),
      )
      if (!site) return notFound(reply)

      const notes: string[] = []

      /**
       * The free half. A failure here is not the caller's problem and not worth a 500: it means
       * this run has one source instead of two, which the note says.
       */
      let rows: Awaited<ReturnType<typeof searchConsoleRows>> = []
      try {
        rows = await searchConsoleRows()
      } catch {
        rows = []
      }

      if (rows.length === 0) {
        notes.push(
          'Search Console contributed nothing: it is not connected for this site, or it reported ' +
            'no question-shaped queries in the last 28 days. That half is free, so connecting ' +
            'Google is the cheapest thing you can do for this list.',
        )
      }

      /** The paid half, asked only when somebody named a subject. */
      let peopleAlsoAsk: string[] = []
      const serp = options.serp?.(request.tenantId, db)

      if (request.query.seed && !serp) {
        notes.push(
          'People Also Ask is not configured, so this is only what Search Console knows ' +
            '(set SERPAPI_API_KEY).',
        )
      }

      if (request.query.seed && serp) {
        try {
          const result = await serp.relatedQuestions(request.query.seed, {
            ...(request.query.country ? { country: request.query.country } : {}),
          })
          peopleAlsoAsk = result.questions
        } catch (error) {
          if (error instanceof SerpBudgetError) {
            return reply.status(429).send({
              error: 'Too Many Requests',
              message: `${error.message}. The cap resets at the start of next calendar month.`,
            })
          }
          notes.push('Google did not answer the People Also Ask query this time.')
        }
      }

      return {
        questions: mineQuestions({
          rows,
          peopleAlsoAsk,
          limit: request.query.limit ?? DEFAULT_QUESTION_LIMIT,
        }),
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      }

      async function searchConsoleRows() {
        const open = await openSearchConsole(
          db,
          {
            tenantId: request.tenantId,
            siteUrl: site!.url,
            gscProperty: site!.gscProperty,
          },
          { ...(options.google ? { config: options.google.config } : {}) },
        )
        if (!open) return []

        const window = defaultWindow()
        return open.gsc.searchAnalytics(open.property, {
          ...window,
          dimensions: ['query'],
          rowLimit: 1000,
        })
      }
    },
  )
}
