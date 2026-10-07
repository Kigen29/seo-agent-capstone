import { apiTokens, asOwner, audits, createDb, findings, sites, tenants, withTenant } from '@seo/db'
import type { FixJob } from '@seo/queue'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'

/**
 * Several pull requests from one request.
 *
 * What has to hold: each finding still becomes its own job (one finding, one pull request), only
 * findings the single Fix button would accept are taken, one that cannot be queued does not stop
 * the others and says why, and another tenant's site is a 404.
 */
const { db, pool } = createDb(process.env.DATABASE_URL)
const SITE = 'https://bulk.example.com'

let app: FastifyInstance
let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string
let siteId: string
let bareSiteId: string
const ids: Record<string, string> = {}
const queued: FixJob[] = []

const post = (path: string, body?: unknown, bearer = token) =>
  app.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${bearer}` },
    ...(body ? { payload: body } : {}),
  })

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

beforeAll(async () => {
  app = await buildApp({
    db,
    enqueueFix: async (job) => {
      queued.push(job)
    },
  })
  const mine = await newTenant('bulk-fix')
  tenantId = mine.id
  token = mine.token
  const other = await newTenant('bulk-fix-other')
  otherTenantId = other.id
  otherToken = other.token

  await withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        tenantId,
        url: `${SITE}/`,
        repoFullName: 'octo/bulk',
        githubInstallationId: 21,
      })
      .returning()
    siteId = site!.id
    // A second site with no repository connected, so nothing on it can be fixed in code.
    const [bare] = await tx
      .insert(sites)
      .values({ tenantId, url: 'https://bare.example.com/' })
      .returning()
    bareSiteId = bare!.id

    const seed = async (
      onSite: string,
      rows: [name: string, impact: number, fixable: boolean, status: 'open' | 'pr_open'][],
    ) => {
      const [audit] = await tx
        .insert(audits)
        .values({ tenantId, siteId: onSite, status: 'complete' })
        .returning()
      for (const [name, impact, fixable, status] of rows) {
        const [row] = await tx
          .insert(findings)
          .values({
            tenantId,
            siteId: onSite,
            auditId: audit!.id,
            ruleId: 'TECH-026',
            key: `TECH-026#${name}`,
            axis: 'content',
            severity: 'medium',
            confidence: 1,
            title: `Finding ${name}`,
            evidence: {
              kind: 'markup',
              url: `${SITE}/${name}`,
              locator: 'meta[name="description"]',
              snippet: '',
              observedAt: '2026-10-01T00:00:00.000Z',
              source: 'crawler',
            },
            affectedUrls: [`${SITE}/${name}`],
            estimatedEffort: 'small',
            estimatedImpact: impact,
            falsification: 'Re-fetch the page; if it has a description, this was wrong.',
            fixable,
            status,
          })
          .returning()
        ids[name] = row!.id
      }
    }
    await seed(siteId, [
      ['second', 40, true, 'open'],
      ['first', 90, true, 'open'],
      ['manual', 95, false, 'open'],
      ['inflight', 99, true, 'pr_open'],
    ])
    await seed(bareSiteId, [['norepo', 50, true, 'open']])
  })
})

beforeEach(() => {
  queued.length = 0
})

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    if (id) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, id)))
  }
  await app.close()
  await pool.end()
})

describe('POST /sites/:id/fixes', () => {
  it('queues one job per open fixable finding, and nothing else', async () => {
    const response = await post(`/sites/${siteId}/fixes`)

    expect(response.statusCode).toBe(202)
    const body = response.json()
    expect(body.queued.map((entry: { id: string }) => entry.id).sort()).toEqual(
      [ids.first, ids.second].sort(),
    )
    expect(body.skipped).toEqual([])
    expect(body.remaining).toBe(0)
    // One finding, one job, one pull request: never a job that carries several.
    expect(queued.map((job) => job.findingRowId).sort()).toEqual([ids.first, ids.second].sort())
    expect(new Set(queued.map((job) => job.requestId)).size).toBe(2)
    expect(queued.every((job) => job.siteId === siteId && job.tenantId === tenantId)).toBe(true)
  })

  it('leaves out a finding that cannot be queued, says why, and still queues the rest', async () => {
    const response = await post(`/sites/${siteId}/fixes`, {
      findingIds: [ids.manual, ids.inflight, ids.first],
    })

    const body = response.json()
    expect(body.queued.map((entry: { id: string }) => entry.id)).toEqual([ids.first])
    expect(body.skipped).toEqual([
      expect.objectContaining({ id: ids.manual, reason: expect.stringContaining('needs a human') }),
      expect.objectContaining({
        id: ids.inflight,
        reason: expect.stringContaining('already been opened'),
      }),
    ])
    expect(queued.map((job) => job.findingRowId)).toEqual([ids.first])
  })

  it('says a repository has to be connected first, and queues nothing', async () => {
    const body = (await post(`/sites/${bareSiteId}/fixes`)).json()

    expect(body.queued).toEqual([])
    expect(body.skipped[0].reason).toContain('Connect a repository')
    expect(queued).toEqual([])
  })

  it('refuses more than ten in one request', async () => {
    const tooMany = Array.from({ length: 11 }, () => ids.first)

    expect((await post(`/sites/${siteId}/fixes`, { findingIds: tooMany })).statusCode).toBe(400)
  })

  it("answers 404 for another tenant's site, and queues nothing", async () => {
    expect((await post(`/sites/${siteId}/fixes`, undefined, otherToken)).statusCode).toBe(404)
    expect(queued).toEqual([])
  })
})

describe('POST /findings/:id/fix still behaves as before', () => {
  it('queues one, and refuses one that is not fixable with a 409', async () => {
    expect((await post(`/findings/${ids.second}/fix`)).statusCode).toBe(202)
    expect(queued.map((job) => job.findingRowId)).toEqual([ids.second])

    const refused = await post(`/findings/${ids.manual}/fix`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().message).toContain('needs a human')
  })
})
