import {
  BillingSignatureError,
  type BillingEvent,
  type BillingProvider,
  type CheckoutRequest,
} from '@seo/connectors'
import { apiTokens, asOwner, createDb, tenants } from '@seo/db'
import { eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * Billing through the API against a real Postgres (ADR-0036).
 *
 * Driven by a fake payment rail, which is the point of the seam: the routes are tested with no
 * key, no network and no vendor, and the same tests would hold for a second rail. What only the
 * database can prove is what a webhook leaves behind on the tenant row, and that it leaves
 * nothing behind when it should not.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)
const NEW_TENANT_CAP = 500_000

/** A rail whose "signature" is a shared word, and whose body is the event it should report. */
class FakeRail implements BillingProvider {
  readonly name = 'fake'
  readonly mode = 'test' as const
  readonly requests: CheckoutRequest[] = []

  async createCheckout(request: CheckoutRequest) {
    this.requests.push(request)
    return { url: `https://rail.test/pay/${request.planId}` }
  }

  parseWebhook(rawBody: string, signature: string | undefined): BillingEvent {
    if (signature !== 'good') throw new BillingSignatureError('bad')
    return JSON.parse(rawBody) as BillingEvent
  }
}

let app: FastifyInstance
let unconfigured: FastifyInstance
let rail: FakeRail
let tenantId: string
let otherTenantId: string
let token: string

const tenantRow = async (id: string) => {
  const [row] = await asOwner(db, (tx) =>
    tx
      .select({ plan: tenants.plan, cap: tenants.monthlyBudgetMicros })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1),
  )
  return row!
}

/** `null` sends no signature header at all; a default parameter would have swallowed `undefined`. */
const webhook = (event: BillingEvent | object, signature: string | null = 'good') =>
  app.inject({
    method: 'POST',
    url: '/webhooks/billing',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'stripe-signature': signature } : {}),
    },
    payload: JSON.stringify(event),
  })

const authed = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  rail = new FakeRail()
  app = await buildApp({ db, billing: { provider: rail }, newTenantBudgetMicros: NEW_TENANT_CAP })
  unconfigured = await buildApp({ db })

  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([
        { name: `billing-${Date.now()}`, monthlyBudgetMicros: NEW_TENANT_CAP },
        { name: `billing-other-${Date.now()}`, monthlyBudgetMicros: NEW_TENANT_CAP },
      ])
      .returning()
    return [rows[0]!.id, rows[1]!.id]
  })

  token = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({ tenantId, name: 'test', tokenHash: hashToken(token) }),
  )
})

beforeEach(async () => {
  rail.requests.length = 0
  await asOwner(db, (tx) =>
    tx
      .update(tenants)
      .set({ plan: 'free', monthlyBudgetMicros: NEW_TENANT_CAP })
      // Only this file's two tenants. The database is shared with every other suite.
      .where(inArray(tenants.id, [tenantId, otherTenantId])),
  )
})

afterAll(async () => {
  await asOwner(db, async (tx) => {
    await tx.delete(tenants).where(eq(tenants.id, tenantId))
    await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
  })
  await app.close()
  await unconfigured.close()
  await pool.end()
})

describe('GET /billing', () => {
  it('says which plan the account is on, in test mode, with the plans there are', async () => {
    const body = (await authed('GET', '/billing')).json()

    expect(body).toMatchObject({ configured: true, provider: 'fake', mode: 'test', plan: 'free' })
    expect(body.plans.map((plan: { id: string }) => plan.id)).toEqual(['free', 'growth', 'agency'])
  })

  it('says billing is off, without failing, when no rail is configured', async () => {
    const response = await unconfigured.inject({
      method: 'GET',
      url: '/billing',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ configured: false, provider: null, plan: 'free' })
  })

  it('needs a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/billing' })).statusCode).toBe(401)
  })
})

describe('POST /billing/checkout', () => {
  it('starts a checkout for the signed-in tenant at the price the plan states', async () => {
    const response = await authed('POST', '/billing/checkout', { planId: 'growth' })

    expect(response.json()).toEqual({ url: 'https://rail.test/pay/growth' })
    expect(rail.requests).toEqual([
      expect.objectContaining({
        tenantId,
        planId: 'growth',
        priceMinor: 300_000,
        currency: 'kes',
        successUrl: expect.stringContaining('/settings/account?billing=success'),
      }),
    ])
  })

  it('does not change the plan: starting to pay is not paying', async () => {
    await authed('POST', '/billing/checkout', { planId: 'agency' })

    expect(await tenantRow(tenantId)).toEqual({ plan: 'free', cap: NEW_TENANT_CAP })
  })

  it.each(['free', 'enterprise'])('refuses the plan %j, which cannot be bought', async (planId) => {
    const response = await authed('POST', '/billing/checkout', { planId })

    expect(response.statusCode).toBe(400)
    expect(rail.requests).toEqual([])
  })

  it('answers 503, and calls nothing, when no rail is configured', async () => {
    const response = await unconfigured.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: 'growth' },
    })

    expect(response.statusCode).toBe(503)
  })
})

describe('POST /webhooks/billing', () => {
  it('moves the tenant to the plan and raises its cap to what the plan grants', async () => {
    const response = await webhook({ kind: 'subscribed', tenantId, planId: 'growth' })

    expect(response.json()).toEqual({ received: true, applied: true })
    expect(await tenantRow(tenantId)).toEqual({ plan: 'growth', cap: 8_000_000 })
  })

  it('changes that tenant and no other', async () => {
    await webhook({ kind: 'subscribed', tenantId, planId: 'agency' })

    expect(await tenantRow(otherTenantId)).toEqual({ plan: 'free', cap: NEW_TENANT_CAP })
  })

  it('is the same after a second delivery of the same event', async () => {
    await webhook({ kind: 'subscribed', tenantId, planId: 'growth' })
    await webhook({ kind: 'subscribed', tenantId, planId: 'growth' })

    expect(await tenantRow(tenantId)).toEqual({ plan: 'growth', cap: 8_000_000 })
  })

  it('returns a cancelled tenant to the free plan and the cap a new account gets', async () => {
    await webhook({ kind: 'subscribed', tenantId, planId: 'agency' })
    await webhook({ kind: 'cancelled', tenantId })

    expect(await tenantRow(tenantId)).toEqual({ plan: 'free', cap: NEW_TENANT_CAP })
  })

  it.each([null, 'forged'])(
    'refuses a delivery with the signature %j and changes nothing',
    async (signature) => {
      const response = await webhook({ kind: 'subscribed', tenantId, planId: 'agency' }, signature)

      expect(response.statusCode).toBe(401)
      expect(await tenantRow(tenantId)).toEqual({ plan: 'free', cap: NEW_TENANT_CAP })
    },
  )

  it('acknowledges and ignores a verified event for a plan that does not exist', async () => {
    const response = await webhook({ kind: 'subscribed', tenantId, planId: 'enterprise' })

    expect(response.json()).toEqual({ received: true, applied: false })
    expect(await tenantRow(tenantId)).toEqual({ plan: 'free', cap: NEW_TENANT_CAP })
  })

  it('acknowledges and ignores a tenant id that is not an id, and one that matches nobody', async () => {
    const malformed = await webhook({ kind: 'subscribed', tenantId: "x'; drop", planId: 'growth' })
    const unknown = await webhook({
      kind: 'subscribed',
      tenantId: '99999999-9999-4999-8999-999999999999',
      planId: 'growth',
    })

    expect(malformed.json()).toEqual({ received: true, applied: false })
    expect(unknown.json()).toEqual({ received: true, applied: false })
  })

  it('answers 503 when no rail is configured, so a stray delivery is not silently accepted', async () => {
    const response = await unconfigured.inject({
      method: 'POST',
      url: '/webhooks/billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
      payload: '{}',
    })

    expect(response.statusCode).toBe(503)
  })
})
