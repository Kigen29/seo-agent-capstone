import { apiTokens, asOwner, createDb, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'
import { DEFAULT_RATE_LIMITS, scaleRateLimits, type RateLimits } from '../src/protect.js'

/**
 * The API's outer defences, through the real app and a real Postgres.
 *
 * Each of these is a property of the assembled server, not of a module: that a refusal carries
 * the same headers as a success, that one account's flood does not lock out another, that an
 * anonymous flood is stopped before the database is asked anything. A unit test of the limiter
 * cannot show any of them.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)

const MINUTE = 60_000
/** Small enough to reach in a test, in the same proportions as the real ones. */
const TIGHT: RateLimits = {
  ceiling: { limit: 1000, windowMs: MINUTE },
  anonymous: { limit: 5, windowMs: MINUTE },
  webhook: { limit: 5, windowMs: MINUTE },
  account: { limit: 8, windowMs: MINUTE },
  costly: { limit: 2, windowMs: MINUTE },
  queued: { limit: 1, windowMs: MINUTE },
}

let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string
const apps: FastifyInstance[] = []

/** A fresh app each time, so one test's counts never reach the next. */
const limited = async (rateLimits: RateLimits = TIGHT) => {
  const app = await buildApp({ db, rateLimits })
  apps.push(app)
  return app
}

const mint = async (tenant: string) => {
  const plain = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({ tenantId: tenant, name: 'test', tokenHash: hashToken(plain) }),
  )
  return plain
}

const as = (bearer: string) => ({ authorization: `Bearer ${bearer}` })

beforeAll(async () => {
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: `protect-${Date.now()}` }, { name: `protect-other-${Date.now()}` }])
      .returning()
    return [rows[0]!.id, rows[1]!.id]
  })
  token = await mint(tenantId)
  otherToken = await mint(otherTenantId)
})

afterAll(async () => {
  await asOwner(db, async (tx) => {
    await tx.delete(tenants).where(eq(tenants.id, tenantId))
    await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
  })
  await Promise.all(apps.map((app) => app.close()))
  await pool.end()
})

describe('security headers', () => {
  const expectHeaders = (headers: Record<string, unknown>) => {
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(headers['cache-control']).toBe('no-store')
  }

  it('are on a successful response', async () => {
    const app = await limited()
    const response = await app.inject({ method: 'GET', url: '/sites', headers: as(token) })

    expect(response.statusCode).toBe(200)
    expectHeaders(response.headers)
  })

  it('are on a refusal, a missing route and a bad request too', async () => {
    const app = await limited()

    expectHeaders((await app.inject({ method: 'GET', url: '/sites' })).headers)
    expectHeaders((await app.inject({ method: 'GET', url: '/no-such-route' })).headers)
    expectHeaders(
      (
        await app.inject({
          method: 'POST',
          url: '/sites',
          headers: as(token),
          payload: { url: 'not a url' },
        })
      ).headers,
    )
  })

  it('never tells a browser on another origin that it may read a response', async () => {
    const app = await limited()
    const response = await app.inject({
      method: 'GET',
      url: '/sites',
      headers: { ...as(token), origin: 'https://evil.example' },
    })

    // With no origin configured this used to be reflected back, with credentials allowed.
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows the one origin that was named, and only that one', async () => {
    const app = await buildApp({ db, corsOrigins: ['https://app.example'] })
    apps.push(app)

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example' },
    })
    const refused = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    })

    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example')
    expect(refused.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('rate limits', () => {
  it('refuses an account that asks too fast, and says when to come back', async () => {
    const app = await limited()
    const statuses: number[] = []
    for (let i = 0; i < TIGHT.account.limit + 1; i++) {
      statuses.push(
        (await app.inject({ method: 'GET', url: '/sites', headers: as(token) })).statusCode,
      )
    }

    expect(statuses.slice(0, TIGHT.account.limit).every((status) => status === 200)).toBe(true)
    expect(statuses.at(-1)).toBe(429)

    const refused = await app.inject({ method: 'GET', url: '/sites', headers: as(token) })
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
    // Named apart from a spent monthly allowance, which is also a 429 and needs other words.
    expect(refused.json().error).toBe('Rate Limited')
  })

  it("does not let one account's flood lock out another", async () => {
    const app = await limited()
    for (let i = 0; i < TIGHT.account.limit + 5; i++) {
      await app.inject({ method: 'GET', url: '/sites', headers: as(token) })
    }

    // Both arrive from the same address, as they do in production, where the web app's own
    // server makes every call. Counting by address would refuse this one.
    const other = await app.inject({ method: 'GET', url: '/sites', headers: as(otherToken) })
    expect(other.statusCode).toBe(200)
  })

  it('holds a costly route to a tighter limit than the account as a whole', async () => {
    const app = await limited()
    const ask = () =>
      app.inject({
        method: 'POST',
        url: '/sites/00000000-0000-4000-8000-00000000dead/competitors/suggestions',
        headers: as(token),
      })

    for (let i = 0; i < TIGHT.costly.limit; i++) expect((await ask()).statusCode).not.toBe(429)
    expect((await ask()).statusCode).toBe(429)

    // The tight limit is per route. Ordinary reading still works.
    const read = await app.inject({ method: 'GET', url: '/sites', headers: as(token) })
    expect(read.statusCode).toBe(200)
  })

  it('stops an anonymous flood before it reaches a route', async () => {
    const app = await limited()
    const statuses: number[] = []
    for (let i = 0; i < TIGHT.anonymous.limit + 2; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/auth/providers' })).statusCode)
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })

  it('never limits the health probes, or the host would restart a healthy instance', async () => {
    const app = await limited()
    for (let i = 0; i < 50; i++) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    }
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200)
  })

  it('does not count a bad token against anybody, and still refuses it', async () => {
    const app = await limited()
    for (let i = 0; i < TIGHT.account.limit + 5; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/sites',
        headers: as('seo_not_a_real_token'),
      })
      expect(response.statusCode).toBe(401)
    }

    // The real account, from the same address, is untouched by somebody else's guesses.
    const real = await app.inject({ method: 'GET', url: '/sites', headers: as(token) })
    expect(real.statusCode).toBe(200)
  })

  it('has a ceiling per address that no token gets around', async () => {
    const app = await limited({ ...TIGHT, ceiling: { limit: 4, windowMs: MINUTE } })
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await app.inject({ method: 'GET', url: '/sites', headers: as(`seo_guess_${i}`) }))
          .statusCode,
      )
    }

    expect(statuses).toEqual([401, 401, 401, 401, 429, 429])
  })

  it('scales every limit by one factor and keeps their proportions', () => {
    const tenth = scaleRateLimits(DEFAULT_RATE_LIMITS, 0.1)

    expect(tenth.account.limit).toBe(DEFAULT_RATE_LIMITS.account.limit / 10)
    expect(tenth.account.windowMs).toBe(DEFAULT_RATE_LIMITS.account.windowMs)
    // Rounded, and never to zero: a route refused outright is an outage, not a limit.
    expect(tenth.queued.limit).toBe(1)
    expect(scaleRateLimits(DEFAULT_RATE_LIMITS, 0.0001).costly.limit).toBe(1)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a scale of %s, which would switch the limits off or make no sense',
    (factor) => {
      expect(() => scaleRateLimits(DEFAULT_RATE_LIMITS, factor)).toThrow(/greater than zero/)
    },
  )

  it('ships defaults a person cannot reach by clicking', () => {
    // A page is a handful of calls, so the account limit has to be several pages a second.
    expect(DEFAULT_RATE_LIMITS.account.limit).toBeGreaterThanOrEqual(120)
    expect(DEFAULT_RATE_LIMITS.costly.limit).toBeLessThan(DEFAULT_RATE_LIMITS.account.limit)
    expect(DEFAULT_RATE_LIMITS.ceiling.limit).toBeGreaterThan(DEFAULT_RATE_LIMITS.account.limit)
  })
})

describe('request size', () => {
  it('refuses a body far larger than anything a caller legitimately sends', async () => {
    const app = await limited()
    const response = await app.inject({
      method: 'PUT',
      url: '/sites/00000000-0000-4000-8000-00000000dead/profile',
      headers: as(token),
      payload: { brand: 'x'.repeat(400 * 1024) },
    })

    expect(response.statusCode).toBe(413)
  })
})
