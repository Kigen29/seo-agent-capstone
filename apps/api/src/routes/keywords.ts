import { siteQueries } from '@seo/audit'
import {
  DEFAULT_GAP_LIMIT,
  DEFAULT_KEYWORD_LIMIT,
  KeywordBudgetError,
  MAX_KEYWORD_LIMIT,
  subtractKnownQueries,
} from '@seo/connectors'
import { sites, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/** Keyword research. The one route in the API that can spend money, so it is the one with a budget. */
export function keywordRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  /**
   * What questions this site is tracked on, and against whom.
   *
   * The AI-visibility axis is the only one that cannot infer its own inputs. Every other axis
   * reads something that already exists; this one needs a human to say what their customers
   * actually ask, because there is no way to derive that from a website, and a guess would
   * measure the guess.
   */
  /**
   * Keyword ideas for a seed term.
   *
   * A read that costs money, which makes it unlike every other GET here. Three things follow
   * from that and all three are in this handler rather than in a provider somewhere:
   *
   *   1. The tenant's budget guard wraps the provider before it is called, so an over-cap tenant
   *      is refused rather than billed (ADR-0017). The refusal is a 429, not a 500: it is a
   *      quota answer about a working system.
   *   2. `limit` is bounded here as well as in the adapter, because rows are most of the bill and
   *      a caller must not be able to ask for a thousand of them by typing a bigger number.
   *   3. With no provider configured the answer is an empty list and a note, not an error. That
   *      is the same posture every other paid surface takes: unmeasured and honest about it.
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/keywords/ideas',
    {
      schema: {
        querystring: z.object({
          seed: z.string().min(1).max(200),
          /** ISO country, e.g. 'ke'. Search volume is per-market. */
          country: z.string().min(2).max(2).optional(),
          language: z.string().min(2).max(5).optional(),
          limit: z.coerce.number().int().min(1).max(MAX_KEYWORD_LIMIT).optional(),
        }),
      },
    },
    async (request, reply) => {
      const provider = options.keywords?.(request.tenantId, db)

      if (!provider) {
        return {
          seed: request.query.seed,
          ideas: [],
          note:
            'Keyword research is not configured. It needs a paid data source ' +
            '(set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD). No keyword data is not the same ' +
            'as no demand, so this is empty rather than zero.',
        }
      }

      try {
        const ideas = await provider.ideas(request.query.seed, {
          ...(request.query.country ? { country: request.query.country } : {}),
          ...(request.query.language ? { language: request.query.language } : {}),
          limit: request.query.limit ?? DEFAULT_KEYWORD_LIMIT,
        })

        return { seed: request.query.seed, ideas }
      } catch (error) {
        if (error instanceof KeywordBudgetError) {
          return reply.status(429).send({
            error: 'Too Many Requests',
            message: `${error.message}. The cap resets at the start of next calendar month.`,
          })
        }
        throw error
      }
    },
  )

  /**
   * What a competitor ranks for that this site does not.
   *
   * Two sources, and the second is the point. The vendor supplies the competitor's rankings; the
   * tenant's own Search Console supplies the truth about which of them this site already appears
   * for, and those are subtracted before anything is returned. A third-party index sees a small
   * site in a small market badly, so its raw gap is padded with terms the client already ranks
   * for, and every competitor tool in this category ships that padding as opportunity.
   *
   * The subtraction is best-effort and says so. Google not connected, a revoked grant, or no
   * matching property all mean the list comes back unsubtracted, which is a materially weaker
   * answer and is reported rather than quietly passed off as a clean gap.
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/sites/:id/keywords/gap',
    {
      schema: {
        params: uuidParam,
        querystring: z.object({
          competitor: z.string().min(3).max(253),
          country: z.string().min(2).max(2).optional(),
          language: z.string().min(2).max(5).optional(),
          limit: z.coerce.number().int().min(1).max(MAX_KEYWORD_LIMIT).optional(),
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

      const provider = options.keywords?.(request.tenantId, db)
      if (!provider) {
        return {
          competitor: request.query.competitor,
          keywords: [],
          subtracted: null,
          note:
            'The keyword gap is not configured. It needs a paid data source ' +
            '(set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD). No keyword data is not the same ' +
            'as no gap, so this is empty rather than zero.',
        }
      }

      try {
        const raw = await provider.gap(site.url, request.query.competitor, {
          ...(request.query.country ? { country: request.query.country } : {}),
          ...(request.query.language ? { language: request.query.language } : {}),
          limit: request.query.limit ?? DEFAULT_GAP_LIMIT,
        })

        const known = await siteQueries(
          db,
          {
            tenantId: request.tenantId,
            siteUrl: site.url,
            gscProperty: site.gscProperty,
          },
          { ...(options.google ? { config: options.google.config } : {}) },
        )

        const { gap, removed } = known ? subtractKnownQueries(raw, known) : { gap: raw, removed: 0 }

        return {
          competitor: gap.competitor,
          keywords: gap.keywords,
          /** Null means the subtraction did not run at all, which is not the same as zero removed. */
          subtracted: known ? removed : null,
          ...(known
            ? {}
            : {
                note:
                  'Search Console is not connected for this site, so nothing was subtracted. ' +
                  'Some of these are probably keywords you already rank for: a third-party index ' +
                  'sees a small site badly, and correcting that is what your own data is for.',
              }),
        }
      } catch (error) {
        if (error instanceof KeywordBudgetError) {
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
