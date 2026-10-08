import { apiTokens, asOwner, audits, createDb, sites, tenants } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * "Not us" through the API, against a real Postgres (ADR-0042).
 *
 * The property only the assembled system can show: marking a site changes what an audit that
 * was already stored reads back as, at once, and unmarking it brings the site back, because the
 * stored audit itself is never rewritten.
 */

const { db, pool } = createDb(process.env.DATABASE_URL)

let app: FastifyInstance
let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string
let siteId: string
let auditId: string

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

const exclude = (domains: string[], bearer?: string) =>
  call('PUT', `/sites/${siteId}/mention-exclusions`, { domains }, bearer)

const authority = async () =>
  (await call('GET', `/audits/${auditId}`)).json().audit.metrics.authority as {
    earnedDomains: number
    unlinkedMentions: string[]
    mentions: { domain: string }[]
  }

beforeAll(async () => {
  app = await buildApp({ db })
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: `notus-${Date.now()}` }, { name: `notus-other-${Date.now()}` }])
      .returning()
    return [rows[0]!.id, rows[1]!.id]
  })
  token = await mint(tenantId)
  otherToken = await mint(otherTenantId)
  ;({ siteId, auditId } = await asOwner(db, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({ tenantId, url: 'https://heartbeestsafaris.com' })
      .returning()
    const [audit] = await tx
      .insert(audits)
      .values({
        tenantId,
        siteId: site!.id,
        status: 'complete',
        metrics: {
          authority: {
            referringDomains: 84,
            earnedDomains: 2,
            selfPublishedDomains: 0,
            unlinkedMentions: ['same-name.example', 'real-press.example'],
            mentions: [
              {
                url: 'https://real-press.example/story',
                domain: 'real-press.example',
                kind: 'earned',
                linked: false,
              },
              {
                url: 'https://same-name.example/tours',
                domain: 'same-name.example',
                kind: 'earned',
                linked: false,
              },
            ],
          },
        },
      })
      .returning()
    return { siteId: site!.id, auditId: audit!.id }
  }))
})

afterAll(async () => {
  await asOwner(db, async (tx) => {
    await tx.delete(tenants).where(eq(tenants.id, tenantId))
    await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
  })
  await app.close()
  await pool.end()
})

describe('marking a site as not us', () => {
  it('starts with nothing excluded, and the audit as it was measured', async () => {
    const profile = (await call('GET', `/sites/${siteId}/profile`)).json()

    expect(profile.mentionExclusions).toEqual([])
    expect((await authority()).earnedDomains).toBe(2)
  })

  it('takes the site out of an audit that was already stored, at once', async () => {
    const response = await exclude(['https://www.Same-Name.example/tours'])

    // Stored as a bare site, whatever was pasted.
    expect(response.json().mentionExclusions).toEqual(['same-name.example'])

    const after = await authority()
    expect(after.earnedDomains).toBe(1)
    expect(after.mentions.map((mention) => mention.domain)).toEqual(['real-press.example'])
    expect(after.unlinkedMentions).toEqual(['real-press.example'])
  })

  it('brings the site back when it is unmarked, because the audit was never rewritten', async () => {
    await exclude([])

    const after = await authority()
    expect(after.earnedDomains).toBe(2)
    expect(after.mentions).toHaveLength(2)
  })

  it('refuses something that is not a web address, and stores nothing', async () => {
    await exclude(['same-name.example'])
    const response = await exclude(['same-name.example', 'not a site'])

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toMatch(/Not a web address: not a site/)
    const profile = (await call('GET', `/sites/${siteId}/profile`)).json()
    expect(profile.mentionExclusions).toEqual(['same-name.example'])
  })

  it("cannot be used on another tenant's site", async () => {
    const response = await exclude(['real-press.example'], otherToken)

    expect(response.statusCode).toBe(404)
    const profile = (await call('GET', `/sites/${siteId}/profile`)).json()
    expect(profile.mentionExclusions).not.toContain('real-press.example')
  })

  it('refuses a list longer than the limit', async () => {
    const many = Array.from({ length: 51 }, (_, index) => `site-${index}.example`)

    expect((await exclude(many)).statusCode).toBe(400)
  })
})
