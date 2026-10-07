import {
  apiTokens,
  asOwner,
  createDb,
  sites,
  tenants,
  visibilityPrompts,
  withTenant,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * A site's own details through the API, against a real Postgres.
 *
 * The web and the model are both faked: pages come from a map, and the model returns whatever the
 * test hands it. What only the database can show is what a save leaves behind, and in particular
 * what it leaves alone.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)

const html = (title: string) =>
  `<html><head><title>${title}</title><meta name="description" content="Guided safaris"></head><body><h1>${title}</h1></body></html>`

/** The whole web, as far as these tests are concerned. Anything not listed does not answer. */
const WEB: Record<string, string> = {
  'named.example.com': html('Named Safaris | Guided trips in Kenya'),
  'generic.example.com': html('Home | Welcome'),
  'real-rival.example.com': html('Real Rival Safaris'),
  'other-rival.example.com': html('Other Rival'),
}

const checkFetch = (async (input: string | URL | Request) => {
  const { hostname } = new URL(String(input))
  const body = WEB[hostname]
  return body === undefined
    ? new Response('not found', { status: 404 })
    : new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}) as unknown as typeof globalThis.fetch
const checkResolve = (async () => [{ address: '93.184.216.34', family: 4 }]) as never

const model = { object: vi.fn() }

let app: FastifyInstance
let noModel: FastifyInstance
let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string

const mint = async (tenant: string) => {
  const plain = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({ tenantId: tenant, name: 'test', tokenHash: hashToken(plain) }),
  )
  return plain
}

const call = (
  target: FastifyInstance,
  method: 'GET' | 'PUT' | 'POST',
  url: string,
  payload?: object,
  bearer: string = token,
) =>
  target.inject({
    method,
    url,
    headers: { authorization: `Bearer ${bearer}` },
    ...(payload ? { payload } : {}),
  })

const addSite = async (host: string) =>
  (await call(app, 'POST', '/sites', { url: `https://${host}` })).json().site as {
    id: string
    brand: string | null
  }

beforeAll(async () => {
  app = await buildApp({ db, checkFetch, checkResolve, outreach: () => model as never })
  noModel = await buildApp({ db, checkFetch, checkResolve })

  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: `profile-${Date.now()}` }, { name: `profile-other-${Date.now()}` }])
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
  await app.close()
  await noModel.close()
  await pool.end()
})

describe('adding a site captures its brand', () => {
  it('reads the name from a homepage title that plainly states it', async () => {
    const site = await addSite('named.example.com')

    expect(site.brand).toBe('Named Safaris')
    const profile = (await call(app, 'GET', `/sites/${site.id}/profile`)).json()
    expect(profile).toMatchObject({ brand: 'Named Safaris', offering: null, competitors: [] })
  })

  it('leaves the brand blank when the title does not state it, and does not guess', async () => {
    expect((await addSite('generic.example.com')).brand).toBeNull()
  })

  it('still adds the site when its homepage does not answer', async () => {
    const site = await addSite('unreachable.example.com')

    expect(site.id).toBeTruthy()
    expect(site.brand).toBeNull()
  })

  it('never overwrites a brand a person typed', async () => {
    const site = await addSite('named.example.com')
    await call(app, 'PUT', `/sites/${site.id}/profile`, { brand: 'Named Safaris Ltd' })

    // Adding the same address again returns the same site, and must not capture over the edit.
    expect((await addSite('named.example.com')).brand).toBe('Named Safaris Ltd')
  })
})

describe('PUT /sites/:id/profile', () => {
  it('saves the name, the offering and the market, tidied', async () => {
    const site = await addSite('named.example.com')

    const saved = (
      await call(app, 'PUT', `/sites/${site.id}/profile`, {
        brand: '  Named   Safaris ',
        offering: 'Private guided safaris\nfor small groups',
        market: 'Kenya',
      })
    ).json()

    expect(saved).toMatchObject({
      brand: 'Named Safaris',
      offering: 'Private guided safaris for small groups',
      market: 'Kenya',
    })
  })

  it('stores an emptied field as nothing, not as an empty string', async () => {
    const site = await addSite('named.example.com')

    const saved = (
      await call(app, 'PUT', `/sites/${site.id}/profile`, { brand: 'X', market: '  ' })
    ).json()

    expect(saved.market).toBeNull()
  })

  it("does not find another tenant's site", async () => {
    const site = await addSite('named.example.com')

    const response = await call(
      app,
      'PUT',
      `/sites/${site.id}/profile`,
      { brand: 'Mine' },
      otherToken,
    )

    expect(response.statusCode).toBe(404)
  })
})

describe('PUT /sites/:id/competitors', () => {
  it('saves competitors as bare domains', async () => {
    const site = await addSite('named.example.com')

    const response = await call(app, 'PUT', `/sites/${site.id}/competitors`, {
      competitors: ['https://www.Real-Rival.example.com/tours', 'other-rival.example.com'],
    })

    expect(response.json()).toEqual({
      competitors: ['real-rival.example.com', 'other-rival.example.com'],
    })
  })

  it('leaves the tracked questions alone', async () => {
    // The reason this route exists: the combined save could delete a question and its history.
    const site = await addSite('named.example.com')
    await withTenant(db, tenantId, (tx) =>
      tx
        .insert(visibilityPrompts)
        .values({ tenantId, siteId: site.id, prompt: 'who runs guided safaris in kenya' })
        .onConflictDoNothing(),
    )

    await call(app, 'PUT', `/sites/${site.id}/competitors`, { competitors: [] })

    const kept = await withTenant(db, tenantId, (tx) =>
      tx.select().from(visibilityPrompts).where(eq(visibilityPrompts.siteId, site.id)),
    )
    expect(kept.map((row) => row.prompt)).toContain('who runs guided safaris in kenya')
  })

  it('refuses something that is not a web address, and says which', async () => {
    const site = await addSite('named.example.com')

    const response = await call(app, 'PUT', `/sites/${site.id}/competitors`, {
      competitors: ['real-rival.example.com', 'Rival Safaris Ltd'],
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('Rival Safaris Ltd')
  })
})

describe('POST /sites/:id/competitors/suggestions', () => {
  it('keeps only the candidates that answer, with their own homepage title', async () => {
    const site = await addSite('named.example.com')
    await call(app, 'PUT', `/sites/${site.id}/profile`, {
      brand: 'Named Safaris',
      offering: 'Private guided safaris',
      market: 'Kenya',
    })
    model.object.mockResolvedValueOnce({
      output: {
        competitors: [
          { domain: 'real-rival.example.com', reason: 'Runs guided safaris in Kenya.' },
          { domain: 'invented-by-the-model.example.com', reason: 'Does not exist.' },
        ],
      },
    })

    const body = (await call(app, 'POST', `/sites/${site.id}/competitors/suggestions`)).json()

    expect(body.suggestions).toEqual([
      {
        domain: 'real-rival.example.com',
        reason: 'Runs guided safaris in Kenya.',
        title: 'Real Rival Safaris',
      },
    ])
    expect(body.dropped).toBe(1)
    expect(body.basedOn).toEqual({ offering: true, market: true, homepage: true })
  })

  it('tells the model what the owner said the business offers and where', async () => {
    const site = await addSite('named.example.com')
    await call(app, 'PUT', `/sites/${site.id}/profile`, {
      offering: 'Balloon safaris at dawn',
      market: 'Maasai Mara',
    })
    model.object.mockResolvedValueOnce({ output: { competitors: [] } })

    await call(app, 'POST', `/sites/${site.id}/competitors/suggestions`)

    const { prompt } = model.object.mock.lastCall![0] as { prompt: string }
    expect(prompt).toContain('Balloon safaris at dawn')
    expect(prompt).toContain('Market: Maasai Mara')
  })

  it('saves nothing: a suggestion is not a competitor until somebody accepts it', async () => {
    const site = await addSite('named.example.com')
    await call(app, 'PUT', `/sites/${site.id}/competitors`, { competitors: [] })
    model.object.mockResolvedValueOnce({
      output: { competitors: [{ domain: 'real-rival.example.com', reason: 'x' }] },
    })

    await call(app, 'POST', `/sites/${site.id}/competitors/suggestions`)

    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select({ competitors: sites.competitors }).from(sites).where(eq(sites.id, site.id)),
    )
    expect(row!.competitors).toEqual([])
  })

  it('answers 503 in plain words when no model is switched on, and still lets you type them', async () => {
    const site = await addSite('named.example.com')

    const response = await call(noModel, 'POST', `/sites/${site.id}/competitors/suggestions`)

    expect(response.statusCode).toBe(503)
    expect(response.json().message).toMatch(/still add competitors by typing/)
  })

  it("does not find another tenant's site, and calls no model for it", async () => {
    const site = await addSite('named.example.com')
    model.object.mockClear()

    const response = await call(
      app,
      'POST',
      `/sites/${site.id}/competitors/suggestions`,
      undefined,
      otherToken,
    )

    expect(response.statusCode).toBe(404)
    expect(model.object).not.toHaveBeenCalled()
  })
})
