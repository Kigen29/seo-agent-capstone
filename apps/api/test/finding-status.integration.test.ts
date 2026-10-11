import { apiTokens, asOwner, audits, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * Dismissing a finding, and reopening one (ADR-0050).
 *
 * The status existed and nothing could set it. What is tested is that it can now be set, only
 * between the two states where nothing is in flight, and only by the tenant that owns it.
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

const put = (id: string, payload: object, bearer: string = token) =>
  app.inject({
    method: 'PUT',
    url: `/findings/${id}/status`,
    headers: { authorization: `Bearer ${bearer}` },
    payload,
  })

async function finding(
  status: (typeof findings.$inferInsert)['status'],
  key: string,
): Promise<string> {
  return asOwner(db, async (tx) => {
    const [row] = await tx
      .insert(findings)
      .values({
        tenantId,
        siteId,
        auditId,
        key: `TECH-006#${key}`,
        ruleId: 'TECH-006',
        axis: 'crawl_health',
        severity: 'low',
        confidence: 1,
        title: `A page has no canonical tag (${key})`,
        evidence: {
          kind: 'markup',
          url: 'https://status.example.com/',
          locator: 'link[rel=canonical]',
          snippet: '',
          observedAt: '2026-10-01T00:00:00.000Z',
          source: 'crawler',
        },
        affectedUrls: ['https://status.example.com/'],
        estimatedEffort: 'trivial',
        estimatedImpact: 20,
        falsification: 'Re-fetch the page. If it declares a canonical, this was wrong.',
        fixable: true,
        status,
      })
      .returning({ id: findings.id })
    return row!.id
  })
}

const statusOf = async (id: string) =>
  (
    await withTenant(db, tenantId, (tx) =>
      tx.select({ status: findings.status }).from(findings).where(eq(findings.id, id)),
    )
  )[0]?.status

beforeAll(async () => {
  app = await buildApp({ db })
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: `status-${Date.now()}` }, { name: `status-other-${Date.now()}` }])
      .returning()
    return [rows[0]!.id, rows[1]!.id]
  })
  token = await mint(tenantId)
  otherToken = await mint(otherTenantId)
  ;({ siteId, auditId } = await asOwner(db, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({ tenantId, url: 'https://status.example.com' })
      .returning()
    const [audit] = await tx
      .insert(audits)
      .values({ tenantId, siteId: site!.id, status: 'complete' })
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

describe('PUT /findings/:id/status', () => {
  it('dismisses an open finding and reopens it, and each can be asked for twice', async () => {
    const id = await finding('open', 'round-trip')

    const dismissed = await put(id, { status: 'wontfix' })
    expect(dismissed.statusCode).toBe(200)
    expect(dismissed.json()).toEqual({ status: 'wontfix' })
    expect(await statusOf(id)).toBe('wontfix')
    expect((await put(id, { status: 'wontfix' })).statusCode).toBe(200)

    expect((await put(id, { status: 'open' })).json()).toEqual({ status: 'open' })
    expect(await statusOf(id)).toBe('open')
  })

  it('leaves a dismissed finding out of the open list, and in the dismissed one', async () => {
    const id = await finding('open', 'listed')
    await put(id, { status: 'wontfix' })
    const list = (status: string) =>
      app
        .inject({
          method: 'GET',
          url: `/findings?siteId=${siteId}&status=${status}&pageSize=100`,
          headers: { authorization: `Bearer ${token}` },
        })
        .then((response) =>
          (response.json().findings as { rowId: string }[]).map((row) => row.rowId),
        )
    expect(await list('open')).not.toContain(id)
    expect(await list('wontfix')).toContain(id)
  })

  it.each([
    ['pr_open', /pull request for this finding is open/],
    ['merged', /merged and is being checked/],
    ['verified', /nothing to dismiss/],
    ['rejected', /did not work/],
  ] as const)('refuses a finding that is %s, and says why', async (status, reason) => {
    const id = await finding(status, `busy-${status}`)
    const response = await put(id, { status: 'wontfix' })
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toMatch(reason)
    // And it cannot be pulled back to open either: that would orphan the work in flight.
    expect((await put(id, { status: 'open' })).statusCode).toBe(409)
    expect(await statusOf(id)).toBe(status)
  })

  it('cannot be used to mark a fix as having worked, or anything else', async () => {
    const id = await finding('open', 'no-shortcuts')
    for (const status of ['verified', 'merged', 'pr_open', 'rejected', 'closed', '']) {
      expect((await put(id, { status })).statusCode, status).toBe(400)
    }
    expect((await put(id, {})).statusCode).toBe(400)
    expect(await statusOf(id)).toBe('open')
  })

  it('is a 404 for another tenant, which changes nothing', async () => {
    const id = await finding('open', 'not-yours')
    expect((await put(id, { status: 'wontfix' }, otherToken)).statusCode).toBe(404)
    expect(await statusOf(id)).toBe('open')
  })

  it('is a 404 for a finding that does not exist, and needs a token', async () => {
    const missing = '00000000-0000-4000-8000-00000000dead'
    expect((await put(missing, { status: 'wontfix' })).statusCode).toBe(404)
    const anonymous = await app.inject({
      method: 'PUT',
      url: `/findings/${missing}/status`,
      payload: { status: 'wontfix' },
    })
    expect(anonymous.statusCode).toBe(401)
  })
})
