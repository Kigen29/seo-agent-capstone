import { createDb } from '@seo/db'
import { signVisitorAddress, VISITOR_ADDRESS_HEADER } from '@seo/core'
import type { FastifyInstance } from 'fastify'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { RateLimits } from '../src/protect.js'

/**
 * Anonymous limits counted per visitor, through the assembled server.
 *
 * Every request here arrives over the same connection, as it does in production, where the web
 * app's own server makes the call for each visitor. The point is that two visitors are counted
 * apart when the web app vouches for them, and that nobody can vouch for themselves.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)

const SECRET = 'a-shared-secret-of-at-least-thirty-two-chars'
const MINUTE = 60_000
const LIMITS: RateLimits = {
  ceiling: { limit: 1000, windowMs: MINUTE },
  anonymous: { limit: 3, windowMs: MINUTE },
  webhook: { limit: 100, windowMs: MINUTE },
  account: { limit: 100, windowMs: MINUTE },
  costly: { limit: 100, windowMs: MINUTE },
  queued: { limit: 100, windowMs: MINUTE },
}

const apps: FastifyInstance[] = []
const server = async (visitorSecret?: string) => {
  const app = await buildApp({
    db,
    rateLimits: LIMITS,
    ...(visitorSecret ? { visitorSecret } : {}),
  })
  apps.push(app)
  return app
}

/** One anonymous request, as the web app would send it for a visitor at `address`. */
const ask = async (app: FastifyInstance, headers: Record<string, string> = {}) =>
  (await app.inject({ method: 'GET', url: '/auth/providers', headers })).statusCode

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()))
  await pool.end()
})

describe('anonymous limits, per visitor', () => {
  it('counts two visitors apart when the web app vouches for each', async () => {
    const app = await server(SECRET)
    const first = await signVisitorAddress(SECRET, '203.0.113.7')
    const second = await signVisitorAddress(SECRET, '198.51.100.20')

    // The first visitor uses up their allowance, and one more.
    for (let i = 0; i < LIMITS.anonymous.limit; i++) expect(await ask(app, first)).toBe(200)
    expect(await ask(app, first)).toBe(429)

    // The second, arriving over the same connection, has theirs untouched.
    expect(await ask(app, second)).toBe(200)
  })

  it('does not believe an address nobody signed', async () => {
    const app = await server(SECRET)

    // A caller claiming a new address on every request, to never be counted twice.
    const statuses: number[] = []
    for (let i = 0; i < LIMITS.anonymous.limit + 2; i++) {
      statuses.push(await ask(app, { [VISITOR_ADDRESS_HEADER]: `203.0.113.${i}` }))
    }

    // Counted as one caller, by the address we can see, and limited like one.
    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })

  it('does not believe an address signed with some other secret', async () => {
    const app = await server(SECRET)
    const statuses: number[] = []
    for (let i = 0; i < LIMITS.anonymous.limit + 2; i++) {
      statuses.push(
        await ask(
          app,
          await signVisitorAddress('an-attackers-guess-of-thirty-two-characters', `203.0.113.${i}`),
        ),
      )
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })

  it('believes nothing at all when the API has no secret, exactly as before', async () => {
    const app = await server()
    const statuses: number[] = []
    for (let i = 0; i < LIMITS.anonymous.limit + 2; i++) {
      statuses.push(await ask(app, await signVisitorAddress(SECRET, `203.0.113.${i}`)))
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })
})
