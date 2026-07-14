import { apiTokens, asOwner, createDb, sites, tenants, withTenant, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { bearerToken, generateToken, hashToken } from '../src/auth.js'

/**
 * The API is the only door to the database, so it is tested against a real one. Its whole
 * job is to authenticate, validate, and scope, and none of those can be proven against a
 * mocked Postgres: the scoping in particular is enforced by row-level security, so a fake
 * database would be testing our beliefs rather than the behaviour (ADR-0008).
 *
 * Requests go through `app.inject`, which exercises the real routing, the real Zod
 * validation, the real auth hook, and the real error handler, without binding a port.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

describe.skipIf(!shouldRun)('the API', () => {
  let db: Database
  let close: () => Promise<void>
  let app: FastifyInstance

  let tenantId: string
  let otherTenantId: string
  let token: string
  let otherToken: string
  let siteId: string

  const mint = (tenant: string) => {
    const plain = generateToken()
    return asOwner(db, async (tx) => {
      await tx
        .insert(apiTokens)
        .values({ tenantId: tenant, name: 'test', tokenHash: hashToken(plain) })
      return plain
    })
  }

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    close = () => created.pool.end()
    app = await buildApp({ db })

    const names = [`api-test-${Date.now()}`, `api-other-${Date.now()}`]
    const [a, b] = await asOwner(db, (tx) =>
      tx
        .insert(tenants)
        .values(names.map((name) => ({ name })))
        .returning(),
    )

    tenantId = a!.id
    otherTenantId = b!.id
    token = await mint(tenantId)
    otherToken = await mint(otherTenantId)

    siteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ tenantId, url: 'https://owned.example.com' })
        .returning()
      return row!.id
    })
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    if (!db) return
    await asOwner(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantId))
      await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
    })
    await close()
  })

  const get = (path: string, bearer?: string) =>
    app.inject({
      method: 'GET',
      url: path,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    })

  describe('authentication', () => {
    it('serves health without a token, because Render has to reach it', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
    })

    it.each([
      ['no header at all', undefined],
      ['an empty bearer', 'Bearer'],
      ['a Basic credential', 'Basic abc123'],
      ['a token that does not exist', 'Bearer seo_not_a_real_token'],
    ])('refuses a request with %s', async (_label, header) => {
      const res = await app.inject({
        method: 'GET',
        url: '/sites',
        headers: header ? { authorization: header } : {},
      })

      expect(res.statusCode).toBe(401)
    })

    it('never trusts a caller who simply asserts a tenant id', async () => {
      // The failure this whole design exists to prevent. A header saying "I am tenant X" is
      // not authentication, it is a request to *be* tenant X. If the API honoured one, row-level
      // security would be decorative all over again, and every hour spent on ADR-0008 wasted.
      const res = await app.inject({
        method: 'GET',
        url: '/sites',
        headers: { 'x-tenant-id': tenantId },
      })

      expect(res.statusCode).toBe(401)
    })

    it('stores only the hash, so a stolen database yields no usable tokens', async () => {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx.select().from(apiTokens).where(eq(apiTokens.tenantId, tenantId)),
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]?.tokenHash).not.toBe(token)
      expect(rows[0]?.tokenHash).toBe(hashToken(token))
      expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('tenant isolation across the HTTP boundary', () => {
    it('shows a tenant only its own sites', async () => {
      const mine = await get('/sites', token)
      const theirs = await get('/sites', otherToken)

      expect(mine.json().sites.map((s: { url: string }) => s.url)).toEqual([
        'https://owned.example.com',
      ])
      expect(theirs.json().sites).toEqual([])
    })

    it('returns 404 and NOT 403 for another tenant resource', async () => {
      // The difference between "you may not see this" and "this does not exist", and it
      // matters far more than it looks. An attacker who can tell 403 from 404 can enumerate
      // which audit ids are real across the whole platform, learn how many customers we have
      // and how active they are, and confirm that a named competitor is a customer, all
      // without reading a single byte of anyone's data.
      //
      // Row-level security makes this honest rather than performative: the query returns no
      // rows, so the handler genuinely cannot tell "not yours" from "not there" either.
      const audit = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert((await import('@seo/db')).audits)
          .values({ tenantId, siteId, status: 'complete' })
          .returning()
        return row!
      })

      const owner = await get(`/audits/${audit.id}`, token)
      const intruder = await get(`/audits/${audit.id}`, otherToken)

      expect(owner.statusCode).toBe(200)
      expect(intruder.statusCode).toBe(404)
      expect(intruder.statusCode).not.toBe(403)
      expect(intruder.json()).toEqual({ error: 'Not Found' })
    })

    it('cannot be steered into another tenant by writing a site they own', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sites',
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { url: 'https://owned.example.com' },
      })

      // The other tenant is allowed to track the same public URL: two agencies auditing the
      // same site is normal. What must not happen is them touching OUR row.
      expect(res.statusCode).toBe(201)
      expect(res.json().site.tenantId).toBe(otherTenantId)
      expect(res.json().site.id).not.toBe(siteId)
    })
  })

  describe('validation', () => {
    it('rejects a malformed uuid with 400, before any query runs', async () => {
      const res = await get('/audits/not-a-uuid', token)

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('Bad Request')
    })

    it('rejects a body that is not a url with 400, not 500', async () => {
      // A malformed request is the caller's problem. Reporting it as a 500 would hide real
      // server errors in the noise, and tell the caller nothing about what they got wrong.
      const res = await app.inject({
        method: 'POST',
        url: '/sites',
        headers: { authorization: `Bearer ${token}` },
        payload: { url: 'not-a-url' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('authenticates before it validates, so an anonymous prober learns nothing', async () => {
      // A 400 here would confirm the route exists and reveal its schema to someone holding
      // no credentials. 401 first gives an unauthenticated caller no signal at all.
      const res = await app.inject({
        method: 'GET',
        url: '/audits/not-a-uuid',
      })

      expect(res.statusCode).toBe(401)
    })
  })

  describe('bearerToken', () => {
    it.each([
      ['Bearer abc', 'abc'],
      ['bearer abc', 'abc'],
      ['BEARER abc', 'abc'],
    ])('parses %s', (header, expected) => {
      expect(bearerToken(header)).toBe(expected)
    })

    it.each([undefined, '', 'Bearer', 'Basic abc', 'Bearer a b', 'abc'])(
      'refuses to guess at %s',
      (header) => {
        expect(bearerToken(header)).toBeUndefined()
      },
    )
  })
})
