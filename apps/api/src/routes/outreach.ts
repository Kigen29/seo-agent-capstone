import { draftOutreach } from '@seo/agent'
import { withTenant, sites } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * Draft a digital-PR email for one mention opportunity. We draft; humans send.
 *
 * CLAUDE.md rule 6 is the shape of this file as much as it is the shape of the drafter. There is
 * no transport here, no address book, no queue and no scheduled send. The route returns text and
 * the grounding it was built on, and everything that would turn that text into an email is a
 * person's deliberate act in their own mail client under their own name.
 *
 * The facts come from the caller rather than from us, and that is the design rather than a gap.
 * The research is blunt about what separates outreach that works: one specific, true, concrete
 * fact nobody else has. That is the one input the client holds and we do not, and inventing it
 * would be the single most expensive mistake this product could make on their behalf. So the
 * route passes the caller's facts through and the drafter refuses when there are none.
 */
const groundingFactSchema = z.object({
  claim: z.string().min(1).max(500),
  sourceUrl: z.string().url().max(2000),
})

const outreachBodySchema = z.object({
  /** The publication being pitched, e.g. 'nation.africa'. */
  domain: z.string().min(1).max(253),
  /** What they already published that makes them a plausible target. */
  context: z.string().max(500).optional(),
  /** Bounded because each one is prompt input, and a caller cannot make one call arbitrarily big. */
  facts: z.array(groundingFactSchema).min(1).max(10),
})

export function outreachRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  app
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/sites/:id/outreach',
      { schema: { params: uuidParam, body: outreachBodySchema } },
      async (request, reply) => {
        if (!options.outreach) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'Drafting is not configured.' })
        }

        // Ownership first, and through RLS, so another tenant's site is a 404 rather than a 403
        // and rather than a billed model call on a site the caller does not own (ADR-0009).
        const [site] = await withTenant(db, request.tenantId, (tx) =>
          tx
            .select({ url: sites.url, brand: sites.brand })
            .from(sites)
            .where(eq(sites.id, request.params.id))
            .limit(1),
        )
        if (!site) return notFound(reply)

        const llm = options.outreach(request.tenantId, db)
        if (!llm) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'Drafting is not configured.' })
        }

        const result = await draftOutreach(
          {
            brand: site.brand ?? new URL(site.url).hostname,
            siteUrl: site.url,
            target: {
              domain: request.body.domain,
              ...(request.body.context ? { context: request.body.context } : {}),
            },
            facts: request.body.facts,
          },
          { llm, tenantId: request.tenantId },
        )

        /*
          A refusal is not an error, and it must not be dressed as one.

          `draftOutreach` returns null when it has nothing concrete to build on, when no chain
          is configured, or when the model's output did not validate. In every one of those
          cases the honest answer is that there is no draft, not that something broke. 422 says
          the request was understood and could not be fulfilled, which is the situation exactly.
        */
        if (!result) {
          return reply.status(422).send({
            error: 'Unprocessable Entity',
            message:
              'No draft. There was nothing specific enough to pitch, or no model is configured. ' +
              'A pitch without one concrete fact is a template, and a template is worse than no email.',
          })
        }

        return result
      },
    )
}
