import { decryptToken, signState } from '@seo/connectors'
import {
  apiTokens,
  asOwner,
  audits,
  createDb,
  oauthCredentials,
  sites,
  tenants,
  withTenant,
  type Database,
} from '@seo/db'
import type { AuditJob } from '@seo/queue'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { bearerToken, generateToken, hashToken } from '../src/auth.js'

// A known encryption key, so signState / encryptToken / decryptToken agree here and in CI,
// which has no .env. Set before any test signs a state.
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

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

  /** Every job the injected enqueue was handed, so a test can prove what was queued. */
  const enqueued: AuditJob[] = []

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
    // A spy enqueue: the queue itself is tested in @seo/queue, so here we only need to prove
    // the route creates the right row and hands the right job over.
    app = await buildApp({
      db,
      enqueue: async (job) => {
        enqueued.push(job)
      },
    })

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

    it('records that a token was used, so an abandoned one can be spotted and revoked', async () => {
      // The column existed and nothing ever wrote to it, which is worse than not having it:
      // a permanently null last_used_at reads as "never used" and would have talked somebody
      // into revoking a live token. Best-effort, though: a failure to write bookkeeping must
      // never turn a valid token into a 401 and lock a customer out of their own account.
      await get('/sites', token)

      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(apiTokens).where(eq(apiTokens.tenantId, tenantId)),
      )

      expect(row?.lastUsedAt).toBeInstanceOf(Date)
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

      /**
       * The assertion that actually proves the property, and the one I had missed.
       *
       * "Cross-tenant returns 404" is only half of it. Non-enumerability requires that a
       * request for somebody else's real audit is INDISTINGUISHABLE from a request for an
       * audit that never existed. If the two responses differed in status, body, or shape by
       * so much as a byte, an attacker could still tell "real, not yours" from "not real",
       * and could still enumerate every audit id on the platform. The 404 would be theatre.
       */
      const missing = await get('/audits/00000000-0000-0000-0000-000000000000', otherToken)

      expect(missing.statusCode).toBe(intruder.statusCode)
      expect(missing.json()).toEqual(intruder.json())
      expect(missing.body).toBe(intruder.body)
    })

    it('gives an owner the same 404 for a missing audit as an intruder gets for a real one', async () => {
      // The same property from the other side: a tenant asking for an id that does not exist
      // must not learn that it does not exist *anywhere*, only that it is not theirs.
      const mine = await get('/audits/00000000-0000-0000-0000-000000000000', token)
      const theirs = await get('/audits/00000000-0000-0000-0000-000000000000', otherToken)

      expect(mine.statusCode).toBe(404)
      expect(mine.body).toBe(theirs.body)
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

  describe('POST /audits', () => {
    it('queues an audit for the caller own site, and hands the worker the right job', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/audits',
        headers: { authorization: `Bearer ${token}` },
        payload: { siteId },
      })

      expect(res.statusCode).toBe(202)
      const { auditId } = res.json() as { auditId: string }
      expect(auditId).toMatch(/^[0-9a-f-]{36}$/)

      // The row exists, scoped to this tenant, and starts queued.
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(audits).where(eq(audits.id, auditId)),
      )
      expect(row?.status).toBe('queued')

      // The worker was handed a job carrying that audit id and the site's URL, so it can run
      // the existing row rather than creating a second one.
      const job = enqueued.find((j) => j.auditId === auditId)
      expect(job).toMatchObject({ auditId, tenantId, siteId, seed: 'https://owned.example.com' })
    })

    it('returns 404 for a site belonging to another tenant, and queues nothing', async () => {
      // The same non-enumerability as the read routes: an intruder must not learn that the
      // site exists, and certainly must not get an audit scheduled against it.
      const before = enqueued.length

      const res = await app.inject({
        method: 'POST',
        url: '/audits',
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { siteId },
      })

      expect(res.statusCode).toBe(404)
      expect(enqueued.length).toBe(before)
    })

    it('rejects a missing or malformed siteId with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/audits',
        headers: { authorization: `Bearer ${token}` },
        payload: { siteId: 'not-a-uuid' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('marks the audit failed rather than leaving it queued when there is no queue', async () => {
      // A build with no enqueue wired must not create a row that hangs on `queued` forever.
      // It fails it with a reason the dashboard can show.
      const noQueue = await buildApp({ db })

      const res = await noQueue.inject({
        method: 'POST',
        url: '/audits',
        headers: { authorization: `Bearer ${token}` },
        payload: { siteId },
      })

      expect(res.statusCode).toBe(503)

      const rows = await withTenant(db, tenantId, (tx) =>
        tx.select().from(audits).where(eq(audits.siteId, siteId)),
      )
      // The most recent audit for this site is the one just created, and it is failed.
      const latest = rows.sort((a, b) => +b.startedAt - +a.startedAt)[0]
      expect(latest?.status).toBe('failed')
      expect(latest?.error).toMatch(/queue is not configured/i)

      await noQueue.close()
    })
  })

  describe('connecting Google', () => {
    const GOOGLE_CONFIG = {
      clientId: 'test.apps.googleusercontent.com',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:4000/auth/google/callback',
    }

    /** A token endpoint that returns a consenting user's tokens. */
    const tokenFetch = () =>
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'access-xyz',
          refresh_token: 'refresh-secret-xyz',
          expires_in: 3600,
          id_token: `x.${Buffer.from(JSON.stringify({ email: 'owner@example.com' })).toString('base64url')}.y`,
        }),
        text: async () => '',
      } as Response)

    it('returns a consent URL signed for this tenant', async () => {
      const google = await buildApp({ db, google: { config: GOOGLE_CONFIG } })

      const res = await google.inject({
        method: 'POST',
        url: '/connections/google',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const url = new URL((res.json() as { url: string }).url)
      expect(url.host).toBe('accounts.google.com')
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('state')).toBeTruthy()

      await google.close()
    })

    it('reports 503 when Google is not configured, rather than a broken consent screen', async () => {
      // The main `app` in this suite has no google option.
      const res = await app.inject({
        method: 'POST',
        url: '/connections/google',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(503)
    })

    it('stores an encrypted refresh token on a valid callback, and redirects connected', async () => {
      const google = await buildApp({
        db,
        webUrl: 'http://web.test',
        google: { config: GOOGLE_CONFIG, fetch: tokenFetch() },
      })

      // The state the start route would have minted for this tenant.
      const state = signState(tenantId)

      const res = await google.inject({
        method: 'GET',
        url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('http://web.test/dashboard?google=connected')

      // The credential is stored, and stored ENCRYPTED: the plaintext refresh token must not
      // appear in the row, and decrypting it must reproduce the original.
      const [cred] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(oauthCredentials).where(eq(oauthCredentials.provider, 'google')),
      )
      expect(cred?.accountEmail).toBe('owner@example.com')
      expect(cred?.refreshTokenEncrypted).not.toContain('refresh-secret-xyz')
      expect(decryptToken(cred!.refreshTokenEncrypted)).toBe('refresh-secret-xyz')

      await google.close()
    })

    it('refuses a callback whose state is forged, and stores nothing', async () => {
      // The property the whole signed-state design exists for: without a bearer token, the
      // callback must not connect a Google account to a tenant the caller merely names.
      const fetchSpy = tokenFetch()
      const google = await buildApp({
        db,
        webUrl: 'http://web.test',
        google: { config: GOOGLE_CONFIG, fetch: fetchSpy },
      })

      const forged = `${Buffer.from(JSON.stringify({ tenantId: otherTenantId, iat: Date.now() })).toString('base64url')}.forgedsig`

      const res = await google.inject({
        method: 'GET',
        url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(forged)}`,
      })

      expect(res.headers.location).toBe('http://web.test/dashboard?google=invalid')
      // The token endpoint was never even called, and no credential was written for the
      // tenant the attacker named.
      expect(fetchSpy).not.toHaveBeenCalled()
      const creds = await withTenant(db, otherTenantId, (tx) =>
        tx.select().from(oauthCredentials).where(eq(oauthCredentials.provider, 'google')),
      )
      expect(creds).toEqual([])

      await google.close()
    })

    it('redirects failed and stores nothing when the token exchange errors', async () => {
      // Google returned a valid-looking callback, but the token endpoint rejected the code
      // (a reused or expired code, say). The credential must not be written, and the error
      // detail must not leak into the redirect URL where it would land in browser history.
      const badToken = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
        text: async () => 'invalid_grant',
      } as Response)

      const google = await buildApp({
        db,
        webUrl: 'http://web.test',
        google: { config: GOOGLE_CONFIG, fetch: badToken },
      })

      // A tenant with no existing credential, so "stored nothing" is unambiguous.
      const freshTenant = await asOwner(db, async (tx) => {
        const [row] = await tx
          .insert(tenants)
          .values({ name: `fresh-${Date.now()}` })
          .returning()
        return row!.id
      })

      try {
        const res = await google.inject({
          method: 'GET',
          url: `/auth/google/callback?code=bad-code&state=${encodeURIComponent(signState(freshTenant))}`,
        })

        expect(res.statusCode).toBe(302)
        expect(res.headers.location).toBe('http://web.test/dashboard?google=failed')
        expect(res.headers.location).not.toMatch(/invalid_grant/)

        const creds = await withTenant(db, freshTenant, (tx) =>
          tx.select().from(oauthCredentials).where(eq(oauthCredentials.provider, 'google')),
        )
        expect(creds).toEqual([])
      } finally {
        await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, freshTenant)))
        await google.close()
      }
    })

    it('sends a user who declined consent back with a note, not an error', async () => {
      const google = await buildApp({
        db,
        webUrl: 'http://web.test',
        google: { config: GOOGLE_CONFIG, fetch: tokenFetch() },
      })

      const res = await google.inject({
        method: 'GET',
        url: '/auth/google/callback?error=access_denied',
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('http://web.test/dashboard?google=declined')

      await google.close()
    })

    it('reports the connection on GET /connections once stored', async () => {
      const res = await get('/connections', token)

      expect(res.statusCode).toBe(200)
      expect(res.json().google).toMatchObject({ connected: true, email: 'owner@example.com' })
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
