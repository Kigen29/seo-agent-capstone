import { apiTokens, asOwner, createDb, sites, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * A competitor's name, typed by the owner, through the API and a real Postgres (ADR-0041).
 *
 * What the database has to show: a typed name is stored against the right competitor, it sits
 * beside the names the daily read captured without disturbing them, and clearing it removes the
 * entry so the daily read takes over again.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)

let app: FastifyInstance
let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string
let siteId: string

const mint = async (tenant: string) => {
  const plain = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({ tenantId: tenant, name: 'test', tokenHash: hashToken(plain) }),
  )
  return plain
}

const name = (domain: string, value: string | null, bearer: string = token) =>
  app.inject({
    method: 'PUT',
    url: `/sites/${siteId}/competitor-names`,
    headers: { authorization: `Bearer ${bearer}` },
    payload: { domain, name: value },
  })

const profile = async () =>
  (
    await app.inject({
      method: 'GET',
      url: `/sites/${siteId}/profile`,
      headers: { authorization: `Bearer ${token}` },
    })
  ).json() as { competitorNames: Record<string, string | null> }

beforeAll(async () => {
  app = await buildApp({ db })
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: `names-${Date.now()}` }, { name: `names-other-${Date.now()}` }])
      .returning()
    return [rows[0]!.id, rows[1]!.id]
  })
  token = await mint(tenantId)
  otherToken = await mint(otherTenantId)
  siteId = await asOwner(db, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        tenantId,
        url: 'https://heartbeestsafaris.com',
        competitors: ['mufasatours.com', 'nameless.example'],
        // As the daily read left it: one name captured, one homepage that states none.
        competitorNames: { 'mufasatours.com': 'Mufasa Tours', 'nameless.example': null },
      })
      .returning()
    return site!.id
  })
})

afterAll(async () => {
  await asOwner(db, async (tx) => {
    await tx.delete(tenants).where(eq(tenants.id, tenantId))
    await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
  })
  await app.close()
  await pool.end()
})

describe('naming a competitor yourself', () => {
  it('reports what the daily read captured, including a homepage that states no name', async () => {
    expect((await profile()).competitorNames).toEqual({
      'mufasatours.com': 'Mufasa Tours',
      'nameless.example': null,
    })
  })

  it('stores a typed name for the competitor that had none, and leaves the other alone', async () => {
    const response = await name('nameless.example', '  Nameless   Safaris Ltd ')

    // Tidied, and returned with every other name as it stands.
    expect(response.json().competitorNames).toEqual({
      'mufasatours.com': 'Mufasa Tours',
      'nameless.example': 'Nameless Safaris Ltd',
    })
    expect((await profile()).competitorNames['nameless.example']).toBe('Nameless Safaris Ltd')
  })

  it('lets a captured name be corrected', async () => {
    await name('mufasatours.com', 'Mufasa Tours and Travel')

    expect((await profile()).competitorNames['mufasatours.com']).toBe('Mufasa Tours and Travel')
  })

  it('removes the entry when the name is cleared, so the daily read takes over again', async () => {
    await name('nameless.example', '')

    const names = (await profile()).competitorNames
    // Absent, not null: null would tell the daily read never to look again.
    expect('nameless.example' in names).toBe(false)
  })

  it('names only a competitor that is tracked', async () => {
    const response = await name('stranger.example', 'A Stranger')

    expect(response.statusCode).toBe(200)
    expect('stranger.example' in response.json().competitorNames).toBe(false)
  })

  it('refuses a name longer than the limit', async () => {
    expect((await name('mufasatours.com', 'x'.repeat(121))).statusCode).toBe(400)
  })

  it("cannot name a competitor on another tenant's site", async () => {
    const response = await name('mufasatours.com', 'Hijacked', otherToken)

    expect(response.statusCode).toBe(404)
    expect((await profile()).competitorNames['mufasatours.com']).toBe('Mufasa Tours and Travel')
  })
})
