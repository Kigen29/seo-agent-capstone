import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  BillingSignatureError,
  LiveBillingRefusedError,
  type BillingEvent,
  type BillingProvider,
  type CheckoutRequest,
} from './types.js'

/**
 * Stripe, in test mode only (ADR-0036).
 *
 * Written against the HTTP API with `fetch`, with no SDK. The surface used is two things, one
 * form-encoded POST and one HMAC, and a vendor SDK for that would be a dependency larger than the
 * feature.
 *
 * Test mode is not a setting here, it is a precondition. The constructor refuses any key that is
 * not a test key, and the webhook reader ignores any event Stripe marks as live, so the two ways
 * real money could enter are both closed in code.
 */

const API = 'https://api.stripe.com/v1'

/** Stripe signs `timestamp.body`. Deliveries older than this are refused as possible replays. */
const TOLERANCE_SECONDS = 300

const TEST_KEY = /^(sk|rk)_test_/

export interface StripeOptions {
  secretKey: string
  webhookSecret: string
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch
}

/** `a[b][c]=v` pairs, which is how Stripe takes nested parameters in a form body. */
function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

interface StripeEvent {
  type?: string
  livemode?: boolean
  data?: { object?: { metadata?: Record<string, string> | null } }
}

export class StripeBilling implements BillingProvider {
  readonly name = 'stripe'
  readonly mode = 'test' as const

  private readonly secretKey: string
  private readonly webhookSecret: string
  private readonly doFetch: typeof globalThis.fetch

  constructor(options: StripeOptions) {
    if (!TEST_KEY.test(options.secretKey)) {
      // Never echo the key, or any part of it, into an error that will reach a log.
      throw new LiveBillingRefusedError(
        'The Stripe key is not a test-mode key. This deployment only runs billing in test mode, ' +
          'so that no real charge can be made. Use a key beginning sk_test_.',
      )
    }
    if (!options.webhookSecret) {
      throw new Error('A Stripe webhook secret is required, or no webhook could be trusted.')
    }

    this.secretKey = options.secretKey
    this.webhookSecret = options.webhookSecret
    this.doFetch = options.fetch ?? globalThis.fetch
  }

  async createCheckout(request: CheckoutRequest): Promise<{ url: string }> {
    const response = await this.doFetch(`${API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form({
        mode: 'subscription',
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        client_reference_id: request.tenantId,
        // On the session, for the event that says checkout completed.
        'metadata[tenantId]': request.tenantId,
        'metadata[planId]': request.planId,
        // And on the subscription, for the event that says it later ended.
        'subscription_data[metadata][tenantId]': request.tenantId,
        'subscription_data[metadata][planId]': request.planId,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': request.currency,
        'line_items[0][price_data][unit_amount]': String(request.priceMinor),
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][product_data][name]': request.planName,
      }),
    })

    if (!response.ok) {
      // Stripe's error body can name the customer or the request; the status is enough to act on.
      throw new Error(`Stripe refused to start a checkout (HTTP ${response.status}).`)
    }

    const session = (await response.json()) as { url?: string | null }
    if (!session.url) throw new Error('Stripe started a checkout and returned no address for it.')
    return { url: session.url }
  }

  parseWebhook(
    rawBody: string,
    signatureHeader: string | undefined,
    now: Date = new Date(),
  ): BillingEvent {
    this.verify(rawBody, signatureHeader, now)

    // Only parsed once it is proved to be Stripe's.
    const event = JSON.parse(rawBody) as StripeEvent

    if (event.livemode !== false) {
      return {
        kind: 'ignored',
        reason: 'A live-mode event, which this deployment does not act on.',
      }
    }

    const metadata = event.data?.object?.metadata ?? {}
    const tenantId = metadata.tenantId
    const planId = metadata.planId

    if (event.type === 'checkout.session.completed') {
      if (!tenantId || !planId) {
        return { kind: 'ignored', reason: 'A completed checkout that names no tenant or plan.' }
      }
      return { kind: 'subscribed', tenantId, planId }
    }

    if (event.type === 'customer.subscription.deleted') {
      if (!tenantId)
        return { kind: 'ignored', reason: 'An ended subscription that names no tenant.' }
      return { kind: 'cancelled', tenantId }
    }

    return {
      kind: 'ignored',
      reason: `Event type ${event.type ?? 'unknown'} changes nothing here.`,
    }
  }

  /**
   * Stripe's scheme: the header carries `t=<unix seconds>` and one or more `v1=<hex hmac>` over
   * `t.body` under the endpoint's secret. Compared in constant time, and only against the exact
   * bytes received, which is why the route keeps the raw body.
   */
  private verify(rawBody: string, header: string | undefined, now: Date): void {
    if (!header) throw new BillingSignatureError('No signature header.')

    const parts = header.split(',').map((part) => part.trim().split('='))
    const timestamp = parts.find(([key]) => key === 't')?.[1]
    const candidates = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '')

    if (!timestamp || !/^\d+$/.test(timestamp) || candidates.length === 0) {
      throw new BillingSignatureError('A signature header in a shape Stripe does not send.')
    }

    const age = Math.abs(now.getTime() / 1000 - Number(timestamp))
    if (age > TOLERANCE_SECONDS) {
      throw new BillingSignatureError('The delivery is too old to trust, and may be a replay.')
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest()

    const matches = candidates.some((candidate) => {
      if (!/^[a-f0-9]{64}$/i.test(candidate)) return false
      return timingSafeEqual(Buffer.from(candidate, 'hex'), expected)
    })

    if (!matches) throw new BillingSignatureError('The signature does not match the body.')
  }
}

/**
 * The billing provider this deployment is configured for, or the reason there is none.
 *
 * Unset keys mean billing is off, which is the default and is not an error. A live key is
 * reported and billing stays off: refusing to start the whole API over it would turn a
 * misconfiguration of an optional feature into an outage of everything else.
 */
export function billingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { provider: BillingProvider } | { provider: null; reason: string } {
  const secretKey = env.STRIPE_SECRET_KEY
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET

  if (!secretKey || !webhookSecret) {
    return {
      provider: null,
      reason: 'Billing is not configured; every account is on the free plan.',
    }
  }

  try {
    return { provider: new StripeBilling({ secretKey, webhookSecret }) }
  } catch (error) {
    return { provider: null, reason: error instanceof Error ? error.message : String(error) }
  }
}
