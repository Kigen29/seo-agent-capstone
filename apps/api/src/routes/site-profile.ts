import { suggestCompetitors } from '@seo/agent'
import {
  getSiteProfile,
  MAX_BRAND,
  MAX_COMPETITORS,
  MAX_MARKET,
  MAX_OFFERING,
  normaliseCompetitors,
  saveCompetitors,
  saveMentionExclusions,
  saveSiteProfile,
  summarisePage,
} from '@seo/audit'
import { MAX_MENTION_EXCLUSIONS } from '@seo/connectors'
import { countryFromUrl, countryName } from '@seo/core'
import { NoProviderConfiguredError } from '@seo/llm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { sendBudgetRefusal } from '../budget-refusal.js'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * A site's own details, and the competitors it is compared with.
 *
 * The brand, what the business offers and where its customers are describe the site, so they are
 * read and written here and not through the AI-visibility settings, which is where the brand and
 * the competitors used to be saved because that page needed them first.
 */

/** How many suggestions are shown. More are asked for, because some do not survive the check. */
const MAX_SHOWN = 8

export function siteProfileRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps
  const typed = app.withTypeProvider<ZodTypeProvider>()

  const fetchOptions = {
    ...(options.checkFetch ? { fetch: options.checkFetch } : {}),
    ...(options.checkResolve ? { resolve: options.checkResolve } : {}),
  }

  typed.get('/sites/:id/profile', { schema: { params: uuidParam } }, async (request, reply) => {
    const profile = await getSiteProfile(db, request.tenantId, request.params.id)
    if (!profile) return notFound(reply)
    return profile
  })

  typed.put(
    '/sites/:id/profile',
    {
      schema: {
        params: uuidParam,
        body: z.object({
          brand: z.string().max(MAX_BRAND).nullish(),
          offering: z.string().max(MAX_OFFERING).nullish(),
          market: z.string().max(MAX_MARKET).nullish(),
        }),
      },
    },
    async (request, reply) => {
      const saved = await saveSiteProfile(db, request.tenantId, request.params.id, request.body)
      if (!saved) return notFound(reply)
      return saved
    },
  )

  typed.put(
    '/sites/:id/competitors',
    {
      schema: {
        params: uuidParam,
        body: z.object({ competitors: z.array(z.string().max(253)).max(MAX_COMPETITORS) }),
      },
    },
    async (request, reply) => {
      const { competitors, invalid } = normaliseCompetitors(request.body.competitors)
      if (invalid.length > 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message:
            `Not a web address: ${invalid.join(', ')}. Give each competitor as its domain, ` +
            'like rivalsafaris.com.',
        })
      }

      const saved = await saveCompetitors(db, request.tenantId, request.params.id, competitors)
      if (!saved) return notFound(reply)
      return { competitors: saved }
    },
  )

  /**
   * The sites that are not about this business, replaced whole (ADR-0042).
   *
   * Reduced to bare hosts by the same rule competitors are, and refused whole if any entry is
   * not a web address, so a typo is reported and not silently stored as a site that matches
   * nothing.
   */
  typed.put(
    '/sites/:id/mention-exclusions',
    {
      schema: {
        params: uuidParam,
        body: z.object({ domains: z.array(z.string().max(253)).max(MAX_MENTION_EXCLUSIONS) }),
      },
    },
    async (request, reply) => {
      const { competitors: domains, invalid } = normaliseCompetitors(request.body.domains)
      if (invalid.length > 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Not a web address: ${invalid.join(', ')}. Give each site as its domain, like example.com.`,
        })
      }

      const saved = await saveMentionExclusions(db, request.tenantId, request.params.id, domains)
      if (!saved) return notFound(reply)
      return { mentionExclusions: saved }
    },
  )

  /**
   * Suggest competitors, each one checked before it is shown.
   *
   * A model names candidates from what the business says it offers and where. A model asked for
   * domains invents some, so each candidate is then fetched through the SSRF guard and kept only
   * if a real page answers. What comes back carries that page's own title, so the person choosing
   * sees what the site says it is and not only what the model said about it.
   *
   * One model call and up to a dozen page fetches, both paid for by the tenant's budget or free.
   * Nothing is saved here: a suggestion becomes a competitor only when somebody accepts it.
   */
  typed.post(
    '/sites/:id/competitors/suggestions',
    { schema: { params: uuidParam } },
    async (request, reply) => {
      const unavailable = () =>
        reply.status(503).send({
          error: 'Service Unavailable',
          message:
            'Suggestions need a language model, and none is switched on for this deployment. ' +
            'You can still add competitors by typing their web addresses.',
        })
      if (!options.outreach) return unavailable()

      const profile = await getSiteProfile(db, request.tenantId, request.params.id)
      if (!profile) return notFound(reply)

      const llm = options.outreach(request.tenantId, db)
      if (!llm) return unavailable()

      const page = await summarisePage(profile.url, fetchOptions)
      const country = countryFromUrl(profile.url)

      let candidates
      try {
        candidates = await suggestCompetitors(llm, request.tenantId, {
          url: profile.url,
          brand: profile.brand,
          offering: profile.offering,
          // What the owner said first; the country in the domain only when they said nothing.
          market: profile.market ?? (country ? countryName(country) : null),
          title: page?.title ?? null,
          description: page?.description ?? null,
          headings: page?.headings ?? [],
          existing: profile.competitors,
        })
      } catch (error) {
        if (error instanceof NoProviderConfiguredError) return unavailable()
        const refused = sendBudgetRefusal(
          reply,
          error,
          'competitors were suggested',
          'You can still add competitors by typing their web addresses.',
        )
        if (refused) return refused
        const message = error instanceof Error ? error.message : String(error)
        /*
          Named, and not rethrown. Rethrowing made this a bare 500, and the page could then only
          say "a fault on our side" for what is nearly always the provider: a key out of credit, a
          rate limit, a request too large for the plan. The provider's own sentence is the only
          thing that tells the person running this what to fix.
        */
        request.log.warn({ err: message }, 'competitor suggestions failed')
        const reason = message.replace(/\s+/g, ' ').slice(0, 180)
        return reply.status(502).send({
          error: 'Bad Gateway',
          message:
            `The language model did not give an answer: ${reason} ` +
            'You can still add competitors by typing their web addresses.',
        })
      }

      // Fetched together: each has its own short timeout, and one slow site should not hold the
      // rest. A candidate that does not answer is dropped, which is where invented domains go.
      const checked = await Promise.all(
        candidates.map(async (candidate) => {
          const home = await summarisePage(`https://${candidate.domain}`, fetchOptions)
          return home ? { ...candidate, title: home.title } : null
        }),
      )
      const suggestions = checked
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .slice(0, MAX_SHOWN)

      return {
        suggestions,
        // So the page can say "5 suggested, 3 did not answer" and not look like it found little.
        dropped: candidates.length - checked.filter(Boolean).length,
        // What the suggestions were based on, so thin results can be explained by thin input.
        basedOn: {
          offering: Boolean(profile.offering),
          market: Boolean(profile.market ?? country),
          homepage: Boolean(page),
        },
      }
    },
  )
}
