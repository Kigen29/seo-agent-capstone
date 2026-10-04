import { decryptToken, encryptToken } from '@seo/connectors'
import {
  apiTokens,
  asOwner,
  audits,
  createDb,
  findings,
  hostingConnections,
  sites,
  tenants,
  withTenant,
} from '@seo/db'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { generateToken, hashToken } from '../src/auth.js'
import { HostingConnectionError, siteHosting } from '../../worker/src/hosting.js'
import { runVerifyFix } from '../../worker/src/verify-fix.js'

/**
 * Per-site hosting connections (ADR-0028).
 *
 * What is under test is the isolation, not Vercel: a customer's token must be validated before it
 * is kept, stored where only that customer's site can use it, never handed back, and refused by
 * the worker the moment it is found attached to anything other than the site it was given for.
 * The provider check itself is injected; `vercel-deployment.test.ts` covers the real one.
 */
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const { db, pool } = createDb(process.env.DATABASE_URL)
const SECRET = 'vercel-token-that-must-never-come-back'

let app: FastifyInstance
let tenantId: string
let otherTenantId: string
let token: string
let otherToken: string
let siteId: string
let bareSiteId: string
let otherSiteId: string
let accept = true
const validated: { token: string; projectId: string; siteUrl: string; repoFullName: string }[] = []

const mint = (tenant: string) => {
  const plain = generateToken()
  return asOwner(db, async (tx) => {
    await tx
      .insert(apiTokens)
      .values({ tenantId: tenant, name: 'test', tokenHash: hashToken(plain) })
    return plain
  })
}

const call = (method: 'GET' | 'PUT' | 'DELETE', id: string, bearer: string, payload?: object) =>
  app.inject({
    method,
    url: `/sites/${id}/hosting`,
    headers: { authorization: `Bearer ${bearer}` },
    ...(payload ? { payload } : {}),
  })

const connect = (id = siteId, bearer = token) =>
  call('PUT', id, bearer, { token: SECRET, projectId: 'prj_abc123' })

beforeAll(async () => {
  app = await buildApp({
    db,
    validateHosting: async (input) => {
      validated.push(input)
      return accept
    },
  })
  ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
    const rows = await tx
      .insert(tenants)
      .values([{ name: 'hosting-a' }, { name: 'hosting-b' }])
      .returning()
    return [rows[0]!.id, rows[1]!.id] as const
  })
  token = await mint(tenantId)
  otherToken = await mint(otherTenantId)
  ;[siteId, bareSiteId] = await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .insert(sites)
      .values([
        {
          tenantId,
          url: 'https://hosting-a.example.com/',
          repoFullName: 'octo/site-a',
          githubInstallationId: 7,
        },
        { tenantId, url: 'https://hosting-norepo.example.com/' },
      ])
      .returning()
    return [rows[0]!.id, rows[1]!.id] as const
  })
  otherSiteId = await withTenant(db, otherTenantId, async (tx) => {
    const [row] = await tx
      .insert(sites)
      .values({
        tenantId: otherTenantId,
        url: 'https://hosting-b.example.com/',
        repoFullName: 'octo/site-b',
        githubInstallationId: 8,
      })
      .returning()
    return row!.id
  })
})

afterAll(async () => {
  await app?.close()
  await asOwner(db, async (tx) => {
    if (tenantId) await tx.delete(tenants).where(eq(tenants.id, tenantId))
    if (otherTenantId) await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
  })
  await pool.end()
})

describe('connecting a hosting project', () => {
  it('reports no connection, and GitHub reports as the path in use', async () => {
    const res = await call('GET', siteId, token)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ mode: 'github', connection: null })
  })

  it('refuses a project the provider check does not confirm, and stores nothing', async () => {
    accept = false
    const res = await connect()
    accept = true

    expect(res.statusCode).toBe(422)
    expect(res.body).not.toContain(SECRET)
    expect((await call('GET', siteId, token)).json().connection).toBeNull()
  })

  it('requires the repository first, because the check is "served from this repository"', async () => {
    const before = validated.length
    const res = await connect(bareSiteId)

    expect(res.statusCode).toBe(409)
    // Not even validated: there is no repository to validate the project against.
    expect(validated.length).toBe(before)
  })

  it('rejects a malformed project id before anything is called', async () => {
    const res = await call('PUT', siteId, token, { token: SECRET, projectId: 'not-a-project' })

    expect(res.statusCode).toBe(400)
  })

  it('validates against the site and repository on record, then stores the token encrypted', async () => {
    const res = await connect()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ connected: true })
    // The caller names a project and a token. The site URL and repository come from our record.
    expect(validated.at(-1)).toMatchObject({
      token: SECRET,
      projectId: 'prj_abc123',
      siteUrl: 'https://hosting-a.example.com/',
      repoFullName: 'octo/site-a',
    })

    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(hostingConnections).where(eq(hostingConnections.siteId, siteId)),
    )
    expect(row?.tokenEncrypted).not.toContain(SECRET)
    expect(JSON.parse(decryptToken(row!.tokenEncrypted))).toEqual({
      tenantId,
      siteId,
      token: SECRET,
    })
  })

  it('never returns the token, in status or anywhere else', async () => {
    const res = await call('GET', siteId, token)

    expect(res.json()).toMatchObject({
      mode: 'vercel',
      connection: { projectId: 'prj_abc123', teamId: null, needsReconnect: false },
    })
    expect(res.body).not.toContain(SECRET)
    expect(res.body).not.toContain('tokenEncrypted')
  })

  it('is a 404 for another tenant on every verb, and leaves the connection alone', async () => {
    expect((await call('GET', siteId, otherToken)).statusCode).toBe(404)
    expect((await connect(siteId, otherToken)).statusCode).toBe(404)
    expect((await call('DELETE', siteId, otherToken)).statusCode).toBe(404)

    expect((await call('GET', siteId, token)).json().connection).not.toBeNull()
    // And the other tenant's own site is untouched by any of it.
    expect((await call('GET', otherSiteId, otherToken)).json().connection).toBeNull()
  })

  it('replaces the token with a new revision, so a check started on the old one cannot save', async () => {
    const revisionOf = async () =>
      (
        await withTenant(db, tenantId, (tx) =>
          tx
            .select({ revision: hostingConnections.revision })
            .from(hostingConnections)
            .where(eq(hostingConnections.siteId, siteId)),
        )
      )[0]?.revision

    const before = await revisionOf()
    expect((await connect()).statusCode).toBe(200)
    expect(await revisionOf()).not.toBe(before)
  })
})

describe('the worker loading a site connection', () => {
  const site = () => ({
    id: siteId,
    url: 'https://hosting-a.example.com/',
    repoFullName: 'octo/site-a',
  })

  it('builds a lookup from the site own connection', async () => {
    const hosting = await siteHosting(db, tenantId, site())

    expect(hosting.revision).toEqual(expect.any(String))
    expect(hosting.deploymentLookup).toEqual(expect.any(Function))
  })

  it('cannot see the connection from another tenant', async () => {
    // Row-level security, not a WHERE clause: the wrong tenant simply finds no row.
    expect(await siteHosting(db, otherTenantId, site())).toEqual({
      revision: null,
      deploymentLookup: undefined,
    })
  })

  it('refuses the connection once the site points at a different repository', async () => {
    await expect(
      siteHosting(db, tenantId, { ...site(), repoFullName: 'octo/renamed' }),
    ).rejects.toBeInstanceOf(HostingConnectionError)
  })

  it('refuses a credential that was issued for a different site', async () => {
    // A row whose ciphertext was copied from another site decrypts to the wrong binding.
    const [original] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ tokenEncrypted: hostingConnections.tokenEncrypted })
        .from(hostingConnections)
        .where(eq(hostingConnections.siteId, siteId)),
    )
    const set = (tokenEncrypted: string) =>
      withTenant(db, tenantId, (tx) =>
        tx
          .update(hostingConnections)
          .set({ tokenEncrypted })
          .where(eq(hostingConnections.siteId, siteId)),
      )

    await set(encryptToken(JSON.stringify({ tenantId, siteId: otherSiteId, token: SECRET })))
    try {
      await expect(siteHosting(db, tenantId, site())).rejects.toThrow(
        /Reconnect the hosting project/,
      )
      await set('not-ciphertext')
      await expect(siteHosting(db, tenantId, site())).rejects.toBeInstanceOf(HostingConnectionError)
    } finally {
      await set(original!.tokenEncrypted)
    }
  })

  it('has nothing to use after a disconnect', async () => {
    expect((await call('DELETE', siteId, token)).json()).toEqual({ connected: false })

    expect(await siteHosting(db, tenantId, site())).toEqual({
      revision: null,
      deploymentLookup: undefined,
    })
    expect((await call('GET', siteId, token)).json()).toEqual({ mode: 'github', connection: null })
  })
})

describe('a verification in flight when the connection changes', () => {
  it('saves nothing, so a disconnect during the crawl cannot produce a later success', async () => {
    expect((await connect()).statusCode).toBe(200)

    const findingId = await withTenant(db, tenantId, async (tx) => {
      const [audit] = await tx
        .insert(audits)
        .values({ tenantId, siteId, status: 'complete' })
        .returning()
      const [finding] = await tx
        .insert(findings)
        .values({
          tenantId,
          siteId,
          auditId: audit!.id,
          ruleId: 'TECH-007',
          key: 'TECH-007#0',
          axis: 'crawl_health',
          severity: 'high',
          confidence: 1,
          title: 'a canonical that redirects',
          evidence: {
            kind: 'http',
            url: 'https://hosting-a.example.com/',
            status: 200,
            redirectChain: [],
            observedAt: '2026-10-04T00:00:00.000Z',
            source: 'crawler',
          },
          affectedUrls: ['https://hosting-a.example.com/about'],
          estimatedEffort: 'trivial',
          estimatedImpact: 70,
          falsification: 'still redirects after merge',
          fixable: true,
          status: 'merged',
          prUrl: 'https://github.com/octo/site-a/pull/9',
        })
        .returning()
      return finding!.id
    })

    await expect(
      runVerifyFix(
        db,
        { tenantId, siteId },
        {
          isDeployed: async () => true,
          // The customer disconnects while the re-crawl is running.
          audit: (async () => {
            await call('DELETE', siteId, token)
            // A clean re-crawl: the rule ran on the affected page and found nothing. Without
            // the guard this is exactly the result that would be saved as "verified".
            return {
              findings: [],
              verificationCoverage: {
                evaluatedRuleIds: ['TECH-007'],
                successfulUrls: ['https://hosting-a.example.com/about'],
              },
            }
          }) as never,
        },
      ),
    ).rejects.toThrow(/changed during verification/)

    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select({ status: findings.status }).from(findings).where(eq(findings.id, findingId)),
    )
    expect(row?.status).toBe('merged')
  })
})
