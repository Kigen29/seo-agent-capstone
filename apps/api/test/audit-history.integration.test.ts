import { fingerprintOf } from '@seo/audit'
import { apiTokens, asOwner, audits, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * Audits as a history, across the HTTP boundary.
 *
 * Three audits of one site. The first raised two issues. The second failed. The third raised one
 * of the first two again, and one new one; the issue that went away had a pull request merged for
 * it. What is asserted is the trail a person reads: every audit is still there, the third is
 * compared with the first and not with the failed one, and the resolved issue names its pull
 * request.
 */
const { db, pool } = createDb(process.env.DATABASE_URL)
const SITE = 'https://history.example.com'
const PR_URL = 'https://github.com/octo/history/pull/9'

let app: FastifyInstance
let tenantId: string
let otherToken: string
let token: string
let siteId: string
let firstId: string
let failedId: string
let thirdId: string

const call = (path: string, bearer = token) =>
  app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${bearer}` } })

const newTenant = async (name: string) => {
  const id = await asOwner(
    db,
    async (tx) => (await tx.insert(tenants).values({ name }).returning())[0]!.id,
  )
  const plain = generateToken()
  await asOwner(db, (tx) =>
    tx.insert(apiTokens).values({ tenantId: id, name: 'test', tokenHash: hashToken(plain) }),
  )
  return { id, token: plain }
}

let otherTenantId: string

beforeAll(async () => {
  app = await buildApp({ db })
  const mine = await newTenant('audit-history')
  tenantId = mine.id
  token = mine.token
  const other = await newTenant('audit-history-other')
  otherTenantId = other.id
  otherToken = other.token

  await withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({ tenantId, url: `${SITE}/` })
      .returning()
    siteId = site!.id

    const audit = async (at: string, status: 'complete' | 'failed', pagesCrawled: number) =>
      (
        await tx
          .insert(audits)
          .values({
            tenantId,
            siteId,
            status,
            startedAt: new Date(at),
            completedAt: new Date(at),
            pagesCrawled,
            ...(status === 'failed' ? { error: 'The site did not answer.' } : {}),
          })
          .returning()
      )[0]!.id
    firstId = await audit('2026-09-01T00:00:00Z', 'complete', 20)
    failedId = await audit('2026-09-15T00:00:00Z', 'failed', 0)
    thirdId = await audit('2026-10-01T00:00:00Z', 'complete', 12)

    const finding = (
      auditId: string,
      ruleId: string,
      page: string,
      over: { status?: 'open' | 'merged'; prUrl?: string } = {},
    ) => ({
      tenantId,
      siteId,
      auditId,
      ruleId,
      key: `${ruleId}#0`,
      fingerprint: fingerprintOf({ ruleId, title: '', affectedUrls: [`${SITE}${page}`] }),
      axis: 'crawl_health' as const,
      severity: ruleId === 'TECH-023' ? ('critical' as const) : ('medium' as const),
      confidence: 1,
      title: `${ruleId} on ${page}`,
      evidence: {
        kind: 'http' as const,
        url: `${SITE}${page}`,
        status: 200,
        redirectChain: [],
        observedAt: '2026-09-01T00:00:00.000Z',
        source: 'crawler' as const,
      },
      affectedUrls: [`${SITE}${page}`],
      estimatedEffort: 'small' as const,
      estimatedImpact: 30,
      falsification: 'Re-fetch the page; if the rule no longer fires, this was wrong.',
      fixable: true,
      status: over.status ?? ('open' as const),
      prUrl: over.prUrl ?? null,
    })

    await tx.insert(findings).values([
      // Fixed between the first audit and the third: a pull request merged for it.
      finding(firstId, 'TECH-023', '/about', { status: 'merged', prUrl: PR_URL }),
      // Raised by both.
      finding(firstId, 'TECH-026', '/contact'),
      finding(thirdId, 'TECH-026', '/contact'),
      // New in the third.
      finding(thirdId, 'TECH-019', '/tours'),
    ])
  })
})

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    if (id) await asOwner(db, (tx) => tx.delete(tenants).where(eqId(id)))
  }
  await app.close()
  await pool.end()
})

// Imported late to keep the fixture above readable.
import { eq } from 'drizzle-orm'
const eqId = (id: string) => eq(tenants.id, id)

describe('GET /sites/:id/audits', () => {
  it('returns every audit of the site, newest first, none replaced by a later one', async () => {
    const response = await call(`/sites/${siteId}/audits`)

    expect(response.statusCode).toBe(200)
    const list = response.json().audits as { id: string; status: string }[]
    expect(list.map((audit) => audit.id)).toEqual([thirdId, failedId, firstId])
    expect(list.map((audit) => audit.status)).toEqual(['complete', 'failed', 'complete'])
  })

  it('compares each completed audit with the completed one before it', async () => {
    const list = (await call(`/sites/${siteId}/audits`)).json().audits as {
      id: string
      findings: number
      changes: { resolved: number; added: number } | null
      error: string | null
    }[]
    const byId = new Map(list.map((audit) => [audit.id, audit]))

    // The third is compared with the first, across the failed one.
    expect(byId.get(thirdId)).toMatchObject({ findings: 2, changes: { resolved: 1, added: 1 } })
    // A failed audit found nothing because it did not look. It is not "everything resolved".
    expect(byId.get(failedId)).toMatchObject({
      changes: null,
      error: 'The site did not answer.',
    })
    // Nothing came before the first.
    expect(byId.get(firstId)).toMatchObject({ findings: 2, changes: null })
  })

  it("answers 404 for another tenant's site", async () => {
    expect((await call(`/sites/${siteId}/audits`, otherToken)).statusCode).toBe(404)
  })
})

describe('GET /audits/:id/changes', () => {
  it('names what was resolved, with its pull request, and what is new', async () => {
    const response = await call(`/audits/${thirdId}/changes`)

    expect(response.statusCode).toBe(200)
    const { changes } = response.json()
    expect(changes.previous.id).toBe(firstId)
    expect(changes.next).toBeNull()
    expect(changes.resolved).toEqual([
      expect.objectContaining({ ruleId: 'TECH-023', status: 'merged', prUrl: PR_URL }),
    ])
    expect(changes.added).toEqual([expect.objectContaining({ ruleId: 'TECH-019', prUrl: null })])
    expect(changes.carried).toBe(1)
    // Fewer pages were reached, which the page uses to warn that "resolved" may mean "not seen".
    expect(changes.pages).toEqual({ before: 20, after: 12 })
  })

  it('has nothing to compare for the first audit, and points at the one after it', async () => {
    const { changes } = (await call(`/audits/${firstId}/changes`)).json()

    expect(changes.previous).toBeNull()
    expect(changes.resolved).toEqual([])
    expect(changes.next.id).toBe(failedId)
  })

  it("answers 404 for another tenant's audit", async () => {
    expect((await call(`/audits/${thirdId}/changes`, otherToken)).statusCode).toBe(404)
  })
})
