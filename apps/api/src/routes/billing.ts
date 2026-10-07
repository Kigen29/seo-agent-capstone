import { BillingSignatureError } from '@seo/connectors'
import { isPaidPlan, planById, PLANS } from '@seo/core'
import { asOwner, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { RouteDeps } from '../options.js'

/**
 * Billing (ADR-0036): a plan raises the monthly cap on paid work, and nothing else.
 *
 * Two halves with two trust models. The signed-in half starts a checkout and says which plan an
 * account is on. The webhook half is public, because the payment rail calls it with no bearer
 * token, and it is the only thing that ever changes a plan: the browser coming back from checkout
 * proves nothing, since anybody can type that address.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const checkoutBody = z.object({ planId: z.string().min(1).max(40) })

export function billingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options, webUrl } = deps
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get('/billing', async (request) => {
    const [tenant] = await asOwner(db, (tx) =>
      tx
        .select({ plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.id, request.tenantId))
        .limit(1),
    )

    return {
      // Off is a state the page has to be able to say, not an error to hide.
      configured: Boolean(options.billing),
      provider: options.billing?.provider.name ?? null,
      mode: 'test' as const,
      plan: tenant?.plan ?? 'free',
      plans: PLANS,
    }
  })

  typed.post('/billing/checkout', { schema: { body: checkoutBody } }, async (request, reply) => {
    if (!options.billing) {
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Billing is not switched on for this deployment.',
      })
    }

    const plan = planById(request.body.planId)
    if (!plan || !isPaidPlan(plan)) {
      return reply
        .status(400)
        .send({ error: 'Bad Request', message: 'That is not a plan that can be bought.' })
    }

    const { url } = await options.billing.provider.createCheckout({
      tenantId: request.tenantId,
      planId: plan.id,
      planName: `RankWright ${plan.name}`,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      // Only for the banner. The plan changes when the webhook says so, never because of these.
      successUrl: `${webUrl}/settings/account?billing=success`,
      cancelUrl: `${webUrl}/settings/account?billing=cancelled`,
    })

    return { url }
  })
}

export async function billingWebhookRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, options } = deps

  await app.register(async (webhookRoutes) => {
    // The signature is over the exact bytes sent, so the raw body is kept beside the parsed one.
    webhookRoutes.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (req, body, done) => {
        req.rawBody = typeof body === 'string' ? body : body.toString('utf8')
        done(null, {})
      },
    )

    webhookRoutes.post('/webhooks/billing', async (request, reply) => {
      if (!options.billing) {
        return reply
          .status(503)
          .send({ error: 'Service Unavailable', message: 'Billing is not configured.' })
      }

      let event
      try {
        const header = request.headers['stripe-signature']
        event = options.billing.provider.parseWebhook(
          request.rawBody ?? '',
          typeof header === 'string' ? header : undefined,
        )
      } catch (error) {
        if (error instanceof BillingSignatureError) {
          // Nothing from an unverified body is read, acted on, or logged.
          return reply.status(401).send({ error: 'Unauthorized', message: 'Bad signature.' })
        }
        throw error
      }

      if (event.kind === 'ignored') return { received: true, applied: false }

      // The ids come from metadata we set at checkout, and the signature proves the rail sent
      // them. They are still checked: a malformed id must not reach the query as a uuid.
      if (!UUID.test(event.tenantId)) return { received: true, applied: false }

      if (event.kind === 'subscribed') {
        const plan = planById(event.planId)
        if (!plan || !isPaidPlan(plan)) return { received: true, applied: false }

        // Setting a plan is idempotent, so a webhook delivered twice changes nothing the second
        // time. That is why no table of seen event ids is needed.
        const updated = await asOwner(db, (tx) =>
          tx
            .update(tenants)
            .set({ plan: plan.id, monthlyBudgetMicros: plan.monthlyBudgetMicros })
            .where(eq(tenants.id, event.tenantId))
            .returning({ id: tenants.id }),
        )
        return { received: true, applied: updated.length > 0 }
      }

      // Cancelled: back to the free plan and the cap a new account on this deployment gets.
      const updated = await asOwner(db, (tx) =>
        tx
          .update(tenants)
          .set({ plan: 'free', monthlyBudgetMicros: options.newTenantBudgetMicros ?? 0 })
          .where(eq(tenants.id, event.tenantId))
          .returning({ id: tenants.id }),
      )
      return { received: true, applied: updated.length > 0 }
    })
  })
}
