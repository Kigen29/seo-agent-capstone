import { shiftMonth, utcDayOf } from '@seo/core'
import { apiTokens, asOwner, createDb, sites, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * The calendar through the API, against a real Postgres (ADR-0044).
 *
 * The scheduling itself is tested where it lives. This is the door: what a request may ask for,
 * what it gets back, and that another tenant gets a 404 and not somebody else's month.
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

const call = (method: 'GET' | 'PUT', url: string, payload?: object, bearer: string = token) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${bearer}` },
    ...(payload ? { payload } : {}),
  })

const thisMonth = utcDayOf(new Date()).slice(0, 7)

beforeAll(async () => {
  app = await buildApp({ db })
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: `calendar-${Date.now()}` }, { name: `calendar-other-${Date.now()}` }])
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
        url: 'https://calendar-test.example.com',
        competitors: ['rival.example'],
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

describe('GET /sites/:id/schedule', () => {
  it('answers with this month when none is named', async () => {
    const response = await call('GET', `/sites/${siteId}/schedule`)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.month).toBe(thisMonth)
    expect(body.today).toBe(utcDayOf(new Date()))
    expect(body.auditCadence).toBe('off')
    // A tracked competitor that has never been read is due today. No audit is, with audits off.
    expect(
      body.events.find((event: { kind: string }) => event.kind === 'competitor_read'),
    ).toMatchObject({ day: body.today, state: 'due', title: 'Read rival.example' })
    expect(body.events.some((event: { kind: string }) => event.kind === 'audit')).toBe(false)
  })

  it('covers whole weeks, so the window starts on or before the 1st', async () => {
    const body = (await call('GET', `/sites/${siteId}/schedule?month=${thisMonth}`)).json()
    expect(body.from <= `${thisMonth}-01`).toBe(true)
    expect(body.to >= `${thisMonth}-28`).toBe(true)
  })

  it('refuses a month that is not one, and one too far away', async () => {
    expect((await call('GET', `/sites/${siteId}/schedule?month=2026-13`)).statusCode).toBe(400)
    expect((await call('GET', `/sites/${siteId}/schedule?month=october`)).statusCode).toBe(400)
    const far = await call('GET', `/sites/${siteId}/schedule?month=${shiftMonth(thisMonth, 13)}`)
    expect(far.statusCode).toBe(400)
    expect(far.json().message).toMatch(/12 months either side/)
    const edge = await call('GET', `/sites/${siteId}/schedule?month=${shiftMonth(thisMonth, 12)}`)
    expect(edge.statusCode).toBe(200)
  })

  it('is a 404 for another tenant, not an empty month', async () => {
    const response = await call('GET', `/sites/${siteId}/schedule`, undefined, otherToken)
    expect(response.statusCode).toBe(404)
  })

  it('needs a token', async () => {
    const response = await app.inject({ method: 'GET', url: `/sites/${siteId}/schedule` })
    expect(response.statusCode).toBe(401)
  })
})

describe('PUT /sites/:id/audit-cadence', () => {
  it('turns scheduled audits on, and the calendar shows the first one due', async () => {
    const saved = await call('PUT', `/sites/${siteId}/audit-cadence`, { cadence: 'weekly' })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toEqual({ auditCadence: 'weekly' })

    const body = (await call('GET', `/sites/${siteId}/schedule`)).json()
    expect(body.auditCadence).toBe('weekly')
    expect(body.events[0]).toMatchObject({ kind: 'audit', state: 'due', day: body.today })
  })

  it('refuses a cadence that is not one of the three', async () => {
    const response = await call('PUT', `/sites/${siteId}/audit-cadence`, { cadence: 'hourly' })
    expect(response.statusCode).toBe(400)
  })

  it("cannot change another tenant's site", async () => {
    const response = await call(
      'PUT',
      `/sites/${siteId}/audit-cadence`,
      { cadence: 'off' },
      otherToken,
    )
    expect(response.statusCode).toBe(404)
    expect((await call('GET', `/sites/${siteId}/schedule`)).json().auditCadence).toBe('weekly')
  })
})
