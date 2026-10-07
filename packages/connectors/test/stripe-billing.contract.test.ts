import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { billingFromEnv, StripeBilling } from '../src/billing/stripe.js'
import { BillingSignatureError, LiveBillingRefusedError } from '../src/billing/types.js'

/**
 * Stripe, as we read it (ADR-0036).
 *
 * A contract test because the two shapes here are somebody else's to change: the form body a
 * checkout session takes, and the signature scheme on a webhook. It also holds the story's
 * falsification condition, "a live charge is made in a demo", which is a property of what this
 * adapter refuses to do.
 */

const SECRET = 'whsec_test_secret'
const KEY = 'sk_test_abc123'
const TENANT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-07T12:00:00.000Z')

const sign = (body: string, at: Date = NOW, secret: string = SECRET): string => {
  const t = Math.floor(at.getTime() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex')
  return `t=${t},v1=${v1}`
}

const event = (type: string, metadata: Record<string, string>, livemode = false): string =>
  JSON.stringify({ id: 'evt_1', type, livemode, data: { object: { metadata } } })

const provider = (fetch?: typeof globalThis.fetch) =>
  new StripeBilling({ secretKey: KEY, webhookSecret: SECRET, ...(fetch ? { fetch } : {}) })

describe('test mode is a precondition, not a setting', () => {
  it.each(['sk_live_abc123', 'rk_live_abc123', 'pk_test_abc123', ''])(
    'refuses to construct with the key %j',
    (secretKey) => {
      expect(() => new StripeBilling({ secretKey, webhookSecret: SECRET })).toThrow(
        LiveBillingRefusedError,
      )
    },
  )

  it('never repeats the key in the refusal, which is headed for a log', () => {
    try {
      new StripeBilling({ secretKey: 'sk_live_do_not_log_me', webhookSecret: SECRET })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).not.toContain('do_not_log_me')
    }
  })

  it('ignores an event Stripe marks as live, even when it is correctly signed', () => {
    const body = event('checkout.session.completed', { tenantId: TENANT, planId: 'growth' }, true)

    expect(provider().parseWebhook(body, sign(body), NOW)).toMatchObject({ kind: 'ignored' })
  })

  it('leaves billing off, with a reason, when the environment holds a live key', () => {
    const result = billingFromEnv({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: SECRET })

    expect(result.provider).toBeNull()
    expect(result).toMatchObject({ reason: expect.stringMatching(/test mode/) })
  })

  it('leaves billing off when nothing is configured, which is the default', () => {
    expect(billingFromEnv({}).provider).toBeNull()
  })
})

describe('starting a checkout', () => {
  it('sends a monthly subscription with the tenant and plan on both the session and the subscription', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.test/c' })),
    ) as unknown as typeof globalThis.fetch

    const result = await provider(fetch).createCheckout({
      tenantId: TENANT,
      planId: 'growth',
      planName: 'RankWright Growth',
      priceMinor: 300_000,
      currency: 'kes',
      successUrl: 'https://app.test/settings/account?billing=success',
      cancelUrl: 'https://app.test/settings/account?billing=cancelled',
    })

    expect(result).toEqual({ url: 'https://checkout.test/c' })

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)

    const sent = Object.fromEntries(new URLSearchParams(init!.body as string))
    expect(sent).toMatchObject({
      mode: 'subscription',
      client_reference_id: TENANT,
      'metadata[tenantId]': TENANT,
      'metadata[planId]': 'growth',
      'subscription_data[metadata][tenantId]': TENANT,
      'line_items[0][price_data][currency]': 'kes',
      'line_items[0][price_data][unit_amount]': '300000',
      'line_items[0][price_data][recurring][interval]': 'month',
    })
  })

  it('fails with the status and nothing from the body, which can name a customer', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'cus_secret_detail' } }), {
        status: 402,
      })) as unknown as typeof globalThis.fetch

    await expect(
      provider(fetch).createCheckout({
        tenantId: TENANT,
        planId: 'growth',
        planName: 'x',
        priceMinor: 1,
        currency: 'kes',
        successUrl: 'https://app.test/a',
        cancelUrl: 'https://app.test/b',
      }),
    ).rejects.toThrow(/HTTP 402/)
  })
})

describe('reading a webhook', () => {
  const completed = event('checkout.session.completed', { tenantId: TENANT, planId: 'growth' })

  it('reads a completed checkout as a subscription to that plan', () => {
    expect(provider().parseWebhook(completed, sign(completed), NOW)).toEqual({
      kind: 'subscribed',
      tenantId: TENANT,
      planId: 'growth',
    })
  })

  it('reads an ended subscription as a cancellation', () => {
    const body = event('customer.subscription.deleted', { tenantId: TENANT, planId: 'growth' })

    expect(provider().parseWebhook(body, sign(body), NOW)).toEqual({
      kind: 'cancelled',
      tenantId: TENANT,
    })
  })

  it('ignores a verified event that changes nothing here', () => {
    const body = event('invoice.paid', { tenantId: TENANT })

    expect(provider().parseWebhook(body, sign(body), NOW)).toMatchObject({ kind: 'ignored' })
  })

  it('ignores a completed checkout that names no tenant, and does not guess one', () => {
    const body = event('checkout.session.completed', {})

    expect(provider().parseWebhook(body, sign(body), NOW)).toMatchObject({ kind: 'ignored' })
  })

  it('refuses a body whose signature was made with another secret', () => {
    expect(() =>
      provider().parseWebhook(completed, sign(completed, NOW, 'whsec_someone_else'), NOW),
    ).toThrow(BillingSignatureError)
  })

  it('refuses a body altered after signing, such as a plan swapped for a dearer one', () => {
    const signature = sign(completed)
    const altered = completed.replace('growth', 'agency')

    expect(() => provider().parseWebhook(altered, signature, NOW)).toThrow(BillingSignatureError)
  })

  it('refuses a correctly signed delivery that is old enough to be a replay', () => {
    const old = new Date(NOW.getTime() - 10 * 60_000)

    expect(() => provider().parseWebhook(completed, sign(completed, old), NOW)).toThrow(
      /too old to trust/,
    )
  })

  it.each([undefined, '', 'v1=abc', 't=notanumber,v1=abc', 't=1,v1=zz'])(
    'refuses the malformed signature header %j without throwing anything else',
    (header) => {
      expect(() => provider().parseWebhook(completed, header, NOW)).toThrow(BillingSignatureError)
    },
  )
})
