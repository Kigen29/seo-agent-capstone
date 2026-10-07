import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { RateLimiter, type RateLimitRule } from './rate-limit.js'

/**
 * The API's outer defences: the headers every response carries, and how fast anybody may call.
 *
 * Kept apart from the routes on purpose. A route says what a resource does; this says what no
 * route should have to remember. A new route is limited and gets its headers by existing.
 */

const MINUTE = 60_000

/**
 * The limits, and who each one is counted against.
 *
 * Who matters more than how many. The web app calls this API from its own server, so most
 * requests arrive from a handful of the host's addresses however many people are using the
 * product. Counting signed-in traffic by address would lump every customer into one bucket and
 * let one busy account lock out the rest. So:
 *
 *   - signed-in requests are counted **per account**,
 *   - requests with no session (sign-in, the free check) are counted **per address**,
 *   - and one high per-address ceiling sits over everything as the flood guard.
 *
 * The numbers are generous for a person and tight for a script. Loading a dashboard page is a
 * handful of calls; nobody clicks "suggest competitors" twelve times in a minute.
 */
export interface RateLimits {
  /** Everything, per address. The flood guard. */
  ceiling: RateLimitRule
  /** Requests carrying no session, per address. */
  anonymous: RateLimitRule
  /** Signed webhook deliveries, per address. A provider redelivers in bursts. */
  webhook: RateLimitRule
  /** Everything a signed-in account does, per account. */
  account: RateLimitRule
  /** A paid search or a model call, per account, per route. */
  costly: RateLimitRule
  /** Starting work on the queue: an audit, a batch of pull requests. Per account, per route. */
  queued: RateLimitRule
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  ceiling: { limit: 1200, windowMs: MINUTE },
  anonymous: { limit: 120, windowMs: MINUTE },
  webhook: { limit: 600, windowMs: MINUTE },
  account: { limit: 600, windowMs: MINUTE },
  costly: { limit: 12, windowMs: MINUTE },
  queued: { limit: 6, windowMs: MINUTE },
}

/**
 * The same limits, each multiplied by a factor.
 *
 * For the operator, set with RATE_LIMIT_SCALE. The defaults suit people using a browser. A
 * deployment that knows it is different can widen or tighten all of them at once without a code
 * change: the browser test suite drives one account from one address as fast as a machine can
 * click, and raises them; a deployment under attack can drop them to a tenth while it is dealt
 * with. One number, so the proportions between the limits, which are the design, stay as they are.
 */
export function scaleRateLimits(limits: RateLimits, factor: number): RateLimits {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('The rate limit scale must be a number greater than zero.')
  }
  const scaled = (rule: RateLimitRule): RateLimitRule => ({
    ...rule,
    // Never below one, or a small factor would refuse every request to a route outright.
    limit: Math.max(1, Math.round(rule.limit * factor)),
  })
  return {
    ceiling: scaled(limits.ceiling),
    anonymous: scaled(limits.anonymous),
    webhook: scaled(limits.webhook),
    account: scaled(limits.account),
    costly: scaled(limits.costly),
    queued: scaled(limits.queued),
  }
}

/**
 * Routes that cost money or start slow work, by method and route pattern.
 *
 * Listed here, in one place, and not as a flag on each route, so the whole policy can be read at
 * once and a reviewer can see what is not on it. The monthly budget already stops these from
 * overspending; this stops them being hammered, which is a different failure: forty model calls
 * in a second is within budget and still takes the instance down.
 */
const TIGHTER: Record<string, keyof Pick<RateLimits, 'costly' | 'queued'>> = {
  'POST /sites/:id/competitors/suggestions': 'costly',
  'POST /sites/:id/visibility/suggestions': 'costly',
  'POST /sites/:id/outreach': 'costly',
  'POST /sites/:id/contributors': 'costly',
  'GET /keywords/ideas': 'costly',
  'GET /sites/:id/keywords/gap': 'costly',
  'GET /sites/:id/questions': 'costly',
  'POST /sites': 'costly',
  'POST /billing/checkout': 'costly',
  'POST /findings/:id/fix': 'costly',
  'POST /audits': 'queued',
  'POST /sites/:id/fixes': 'queued',
  'POST /sites/:id/verify': 'queued',
}

/** Probes from the host. Limiting them would have the platform restart a healthy instance. */
const NEVER_LIMITED = new Set(['/health', '/ready'])

function refuse(reply: FastifyReply, retryAfterSeconds: number) {
  return reply
    .header('retry-after', String(retryAfterSeconds))
    .status(429)
    .send({
      // Distinct from the budget guard's 'Too Many Requests', so a client can tell "slow down"
      // from "this month's allowance is spent". They need different words on screen.
      error: 'Rate Limited',
      message: `Too many requests in a short time. Try again in ${retryAfterSeconds} ${
        retryAfterSeconds === 1 ? 'second' : 'seconds'
      }.`,
    })
}

export interface RateLimiting {
  /** Count a signed-in request. Call it once the account is known. Returns true if refused. */
  account: (request: FastifyRequest, reply: FastifyReply) => boolean
}

/**
 * Install the per-address limits on the whole app, and return the per-account check for the
 * authenticated scope to call once it knows who is asking.
 */
export function installRateLimits(
  app: FastifyInstance,
  limits: RateLimits = DEFAULT_RATE_LIMITS,
  now: () => number = Date.now,
): RateLimiting {
  const limiter = new RateLimiter(now)

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? ''
    if (NEVER_LIMITED.has(path)) return

    const ceiling = limiter.take(`ip:${request.ip}`, limits.ceiling)
    if (!ceiling.allowed) return refuse(reply, ceiling.retryAfterSeconds)

    if (path.startsWith('/webhooks/')) {
      const delivery = limiter.take(`hook:${request.ip}`, limits.webhook)
      if (!delivery.allowed) return refuse(reply, delivery.retryAfterSeconds)
      return
    }

    // No credentials at all: sign-in, an OAuth callback, the free check, or a probe. A request
    // that presents a token is counted by account instead, once the token has been checked.
    if (!request.headers.authorization) {
      const anonymous = limiter.take(`anon:${request.ip}`, limits.anonymous)
      if (!anonymous.allowed) return refuse(reply, anonymous.retryAfterSeconds)
    }
  })

  return {
    account(request, reply) {
      const everything = limiter.take(`account:${request.tenantId}`, limits.account)
      if (!everything.allowed) {
        void refuse(reply, everything.retryAfterSeconds)
        return true
      }

      const route = `${request.method} ${request.routeOptions?.url ?? ''}`
      const tier = TIGHTER[route]
      if (tier) {
        const tight = limiter.take(`${tier}:${request.tenantId}:${route}`, limits[tier])
        if (!tight.allowed) {
          void refuse(reply, tight.retryAfterSeconds)
          return true
        }
      }
      return false
    },
  }
}

/**
 * The headers every response carries.
 *
 * This API answers with JSON and redirects and is never meant to be rendered, framed or cached,
 * so the policy is the strictest there is and costs nothing:
 *
 *   - no content sniffing, so a JSON body can never be reinterpreted as a script,
 *   - no framing and a content policy that loads nothing, so a response opened directly in a
 *     browser cannot run or embed anything,
 *   - no referrer, so an address carrying a one-time code is not passed on,
 *   - no storing, because nearly every response is one account's private data and a shared cache
 *     holding it is a leak. A route that is public and cacheable sets its own header after this.
 *
 * Set at the start of the request, so they are on error responses and refusals too.
 */
export function installSecurityHeaders(app: FastifyInstance, production: boolean): void {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('x-frame-options', 'DENY')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
    reply.header('cross-origin-resource-policy', 'same-origin')
    reply.header('cache-control', 'no-store')
    // Only over TLS, which production always is. Sent from a local http server it would be
    // ignored by a browser and confuse the person reading the response.
    if (production) {
      reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains')
    }
  })
}
