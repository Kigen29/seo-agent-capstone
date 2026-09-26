import type { OutreachLlm } from '@seo/agent'
import type { IdentityProvider, SocialIdentity } from '@seo/connectors'
import {
  decryptToken,
  DEFAULT_GAP_LIMIT,
  DEFAULT_KEYWORD_LIMIT,
  KeywordBudgetError,
  signState,
} from '@seo/connectors'
import { priorityScore } from '@seo/core'
import {
  apiTokens,
  asOwner,
  audits,
  createDb,
  findings,
  oauthCredentials,
  publicChecks,
  sites,
  tenants,
  userIdentities,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import type { AuditJob, ConfirmVerifyJob, FixJob, VerifyFixJob, VerifyJob } from '@seo/queue'
import type { InstalledRepo } from '@seo/vcs'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { bearerToken, generateToken, hashToken } from '../src/auth.js'
import { signInstallState } from '../src/github-state.js'

/** The fake GitHub App injected into the API: it lists one repo and signs webhooks with a
 * known secret, so the connect, callback, and webhook routes can be exercised without GitHub. */
const WEBHOOK_SECRET = 'test-webhook-secret'
const INSTALLATION_ID = 4242
const installationRepos: InstalledRepo[] = [
  { owner: 'octo', name: 'owned', fullName: 'octo/owned', defaultBranch: 'main' },
]
const signWebhook = (body: string) =>
  'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')

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
  const verifyEnqueued: VerifyJob[] = []
  const confirmEnqueued: ConfirmVerifyJob[] = []
  const fixEnqueued: FixJob[] = []
  let failFixQueue = false
  let failVerifyQueue = false
  const verifyFixEnqueued: VerifyFixJob[] = []

  /**
   * The model the outreach route is handed, swapped per test.
   *
   * A fake rather than a chain, so these tests spend nothing and do not depend on a key being
   * present in CI. What is under test here is the route's contract, not the model's prose.
   */
  let outreachModel: OutreachLlm | undefined

  /** What the fake provider will claim the next `identify` proved. Set per test by signIn. */
  let nextIdentity: SocialIdentity = { provider: 'fake', accountId: 'acct-1', name: 'Kigen' }
  const fakeProvider: IdentityProvider = {
    name: 'fake',
    authUrl: (state) => `https://provider.example/authorize?state=${encodeURIComponent(state)}`,
    identify: async () => nextIdentity,
  }
  /** Every prompt the fake was given, so a test can prove what the model was and was not told. */
  const outreachPrompts: string[] = []

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
      enqueueVerify: async (job) => {
        if (failVerifyQueue) throw new Error('simulated queue outage')
        verifyEnqueued.push(job)
      },
      enqueueConfirmVerify: async (job) => {
        confirmEnqueued.push(job)
      },
      enqueueFix: async (job) => {
        if (failFixQueue) throw new Error('simulated queue outage')
        fixEnqueued.push(job)
      },
      enqueueVerifyFix: async (job) => {
        verifyFixEnqueued.push(job)
      },
      outreach: () => outreachModel,
      identityProviders: { fake: fakeProvider },
      github: {
        userAuthorization: {
          clientId: 'test-id',
          clientSecret: 'test-secret',
          redirectUri: 'https://api.example/connections/github/callback',
          fetch: async (url) =>
            String(url).includes('access_token')
              ? Response.json({ access_token: 'user-test-token' })
              : Response.json({ repositories: [] }),
        },
        app: {
          // apiFor is exercised by the fixer stories, not here; listing is what the callback uses.
          apiFor: (() => {
            throw new Error('apiFor is not used in these tests')
          }) as never,
          listInstallationRepositories: async () => installationRepos,
        },
        slug: 'rankwright-seo-agent',
        webhookSecret: WEBHOOK_SECRET,
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

    it.each([
      ['an expired session', 'Browser session', 'session', -1, 401],
      ['a session inside its lifetime', 'Browser session', 'session', 1, 200],
      ['a token past an explicit expiry', 'automation token', 'token', -1, 401],
      ['a token with no expiry', 'automation token', 'token', null, 200],
      // The name is a label, not a rule: a hand-minted token called this is not a session.
      ['an unexpiring token named like a session', 'Browser session', 'token', null, 200],
    ] as const)('decides %s from its stored expiry', async (_label, name, kind, days, status) => {
      const plain = generateToken()
      const [row] = await asOwner(db, (tx) =>
        tx
          .insert(apiTokens)
          .values({
            tenantId,
            name,
            kind,
            tokenHash: hashToken(plain),
            createdAt: new Date(Date.now() - 400 * 86_400_000),
            expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000),
          })
          .returning(),
      )
      try {
        expect((await get('/sites', plain)).statusCode).toBe(status)
        if (status === 401) {
          const [stored] = await asOwner(db, (tx) =>
            tx.select().from(apiTokens).where(eq(apiTokens.id, row!.id)),
          )
          expect(stored?.lastUsedAt).toBeNull()
        }
      } finally {
        await asOwner(db, (tx) => tx.delete(apiTokens).where(eq(apiTokens.id, row!.id)))
      }
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

  describe('connecting a repository', () => {
    const postJson = (path: string, payload: unknown, bearer?: string) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
        payload: payload as object,
      })

    const webhook = (event: string, body: string, signature: string) =>
      app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-github-event': event,
          'x-hub-signature-256': signature,
        },
        payload: body,
      })

    it('hands back a signed install URL for a site the caller owns', async () => {
      const res = await postJson('/connections/github', { siteId }, token)

      expect(res.statusCode).toBe(200)
      const url = res.json().url as string
      expect(url).toContain('github.com/apps/rankwright-seo-agent/installations/select_target')
      expect(url).toContain('state=')
    })

    it('returns 404, not 403, for another tenant’s site', async () => {
      const res = await postJson('/connections/github', { siteId }, otherToken)
      expect(res.statusCode).toBe(404)
    })

    it('reports 503 when GitHub is not configured', async () => {
      const bare = await buildApp({ db })
      const res = await bare.inject({
        method: 'POST',
        url: '/connections/github',
        headers: { authorization: `Bearer ${token}` },
        payload: { siteId },
      })
      expect(res.statusCode).toBe(503)
      await bare.close()
    })

    it('rejects the callback with an invalid state, without touching the site', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/connections/github/callback?installation_id=${INSTALLATION_ID}&state=not-valid`,
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toContain('github=invalid')
    })

    it('records the installation and the resolved repo on the site (the demo path)', async () => {
      const state = signInstallState({ tenantId, siteId, installationId: INSTALLATION_ID })
      const res = await app.inject({
        method: 'GET',
        url:
          `/connections/github/callback?installation_id=${INSTALLATION_ID}` +
          `&code=user-code&setup_action=install&state=${encodeURIComponent(state)}`,
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toContain('github=connected')

      const site = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(sites).where(eq(sites.id, siteId)).limit(1)
        return row
      })
      expect(site?.githubInstallationId).toBe(INSTALLATION_ID)
      expect(site?.repoFullName).toBe('octo/owned')
    })

    it('reports the connected repo on GET /connections once stored', async () => {
      const res = await get('/connections', token)
      expect(res.statusCode).toBe(200)
      expect(res.json().github).toMatchObject({ connected: true })
      expect(res.json().github.repos).toContain('octo/owned')
    })

    // From here the tenant already has an installation (set by the demo-path test above), so a
    // second site must not re-install (which would drop our state and look cancelled): it offers
    // the repositories the app can see, and the user picks one.

    it('offers a repo picker for a second site once the app is installed', async () => {
      const secondSiteId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://second.example.com' })
          .returning()
        return row!.id
      })

      const res = await postJson('/connections/github', { siteId: secondSiteId }, token)

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('pick')
      expect(body.repos).toContainEqual({ fullName: 'octo/owned', installationId: INSTALLATION_ID })
      expect(body.manageUrl).toBe('https://github.com/settings/installations')

      // The picker does not bind anything on its own; a repo is bound by the choose step below.
      const site = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(sites).where(eq(sites.id, secondSiteId)).limit(1)
        return row
      })
      expect(site?.repoFullName).toBeNull()
    })

    it('binds a repo the user picked via POST /sites/:id/repo', async () => {
      const pickSiteId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://pick.example.com' })
          .returning()
        return row!.id
      })

      const res = await postJson(`/sites/${pickSiteId}/repo`, { repoFullName: 'octo/owned' }, token)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ repoFullName: 'octo/owned' })

      const site = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(sites).where(eq(sites.id, pickSiteId)).limit(1)
        return row
      })
      expect(site?.repoFullName).toBe('octo/owned')
      expect(site?.githubInstallationId).toBe(INSTALLATION_ID)
    })

    it('refuses to bind a repo the app cannot access, with a 409', async () => {
      const res = await postJson(
        `/sites/${siteId}/repo`,
        { repoFullName: 'octo/not-granted' },
        token,
      )
      expect(res.statusCode).toBe(409)
    })

    it('gives another tenant a 404 when binding a repo to a site that is not theirs', async () => {
      const res = await postJson(
        `/sites/${siteId}/repo`,
        { repoFullName: 'octo/owned' },
        otherToken,
      )
      expect(res.statusCode).toBe(404)
    })

    it('turns away a webhook with a bad signature before reading it', async () => {
      const body = JSON.stringify({ action: 'created', installation: { id: INSTALLATION_ID } })
      const res = await webhook('installation', body, 'sha256=deadbeef')
      expect(res.statusCode).toBe(401)
    })

    it('accepts a webhook GitHub genuinely signed', async () => {
      const body = JSON.stringify({ action: 'created', installation: { id: INSTALLATION_ID } })
      const res = await webhook('installation', body, signWebhook(body))
      expect(res.statusCode).toBe(204)
    })

    it('disconnects every site under an installation that was deleted', async () => {
      const body = JSON.stringify({ action: 'deleted', installation: { id: INSTALLATION_ID } })
      const res = await webhook('installation', body, signWebhook(body))
      expect(res.statusCode).toBe(204)

      const site = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(sites).where(eq(sites.id, siteId)).limit(1)
        return row
      })
      expect(site?.githubInstallationId).toBeNull()
      expect(site?.repoFullName).toBeNull()
    })

    it('enqueues a confirm job when a verification PR is merged', async () => {
      const vsiteId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: 'https://vmerge.example.com',
            gscProperty: 'https://vmerge.example.com/',
            repoFullName: 'o/r',
            githubInstallationId: INSTALLATION_ID,
            gscVerificationPrUrl: 'https://github.com/o/r/pull/1',
          })
          .returning()
        return row!.id
      })

      const body = JSON.stringify({
        action: 'closed',
        installation: { id: INSTALLATION_ID },
        repository: { full_name: 'o/r' },
        pull_request: {
          merged: true,
          html_url: 'https://github.com/o/r/pull/1',
          head: { ref: `seo-agent/AGENT-VERIFY-${vsiteId}-t1-verify` },
        },
      })
      const res = await webhook('pull_request', body, signWebhook(body))

      expect(res.statusCode).toBe(204)
      expect(confirmEnqueued.at(-1)).toMatchObject({ tenantId, siteId: vsiteId })

      const site = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(sites).where(eq(sites.id, vsiteId)).limit(1)
        return row
      })
      expect(site?.gscVerificationStatus).toBe('merged')
    })

    it('resets a site to none when its verification PR is closed unmerged', async () => {
      const closedId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: 'https://vclosed.example.com',
            repoFullName: 'o/r',
            githubInstallationId: INSTALLATION_ID,
            gscVerificationStatus: 'pr_open',
            gscVerificationPrUrl: 'https://github.com/o/r/pull/1',
          })
          .returning()
        return row!.id
      })

      const body = JSON.stringify({
        action: 'closed',
        installation: { id: INSTALLATION_ID },
        repository: { full_name: 'o/r' },
        pull_request: {
          merged: false,
          html_url: 'https://github.com/o/r/pull/1',
          head: { ref: `seo-agent/AGENT-VERIFY-${closedId}-t1-x` },
        },
      })
      const res = await webhook('pull_request', body, signWebhook(body))
      expect(res.statusCode).toBe(204)

      const site = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(sites).where(eq(sites.id, closedId)).limit(1)
        return row
      })
      expect(site?.gscVerificationStatus).toBe('none')
      expect(site?.gscVerificationPrUrl).toBeNull()
    })

    /** A site with a repo, an audit, and one fix finding whose PR is open at `prUrl`. */
    const seedFixFinding = async (url: string, prUrl: string) => {
      const fxSiteId = await withTenant(db, tenantId, async (tx) => {
        const [s] = await tx
          .insert(sites)
          .values({
            tenantId,
            url,
            repoFullName: 'octo/owned',
            githubInstallationId: INSTALLATION_ID,
          })
          .returning()
        return s!.id
      })
      const auditId = await withTenant(db, tenantId, async (tx) => {
        const [a] = await tx
          .insert(audits)
          .values({ tenantId, siteId: fxSiteId, status: 'complete' })
          .returning()
        return a!.id
      })
      const findingId = await withTenant(db, tenantId, async (tx) => {
        const [f] = await tx
          .insert(findings)
          .values({
            tenantId,
            siteId: fxSiteId,
            auditId,
            ruleId: 'TECH-007',
            key: 'TECH-007#0',
            axis: 'crawl_health',
            severity: 'high',
            confidence: 1,
            title: 'a canonical that redirects',
            evidence: {
              kind: 'http',
              url: 'https://www.example.com/',
              status: 200,
              redirectChain: ['https://example.com/'],
              observedAt: '2026-07-19T00:00:00.000Z',
              source: 'crawler',
            },
            affectedUrls: ['https://example.com/about'],
            estimatedEffort: 'trivial',
            estimatedImpact: 70,
            falsification: 'still redirects after merge',
            fixable: true,
            status: 'pr_open',
            prUrl,
          })
          .returning()
        return f!.id
      })
      return { fxSiteId, findingId }
    }

    it('marks a finding merged and enqueues verification when its fix PR is merged', async () => {
      const prUrl = 'https://github.com/octo/owned/pull/501'
      const { fxSiteId, findingId } = await seedFixFinding('https://fixmerge.example.com', prUrl)

      const body = JSON.stringify({
        action: 'closed',
        repository: { full_name: 'octo/owned' },
        installation: { id: INSTALLATION_ID },
        pull_request: {
          merged: true,
          html_url: prUrl,
          head: { ref: 'seo-agent/TECH-007-0-canonical' },
        },
      })
      const res = await webhook('pull_request', body, signWebhook(body))

      expect(res.statusCode).toBe(204)
      expect(verifyFixEnqueued.at(-1)).toMatchObject({ tenantId, siteId: fxSiteId })

      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select({ status: findings.status }).from(findings).where(eq(findings.id, findingId)),
      )
      expect(row?.status).toBe('merged')
    })

    it.each([
      ['wrong repository', { full_name: 'other/repo' }, { id: INSTALLATION_ID }],
      ['wrong installation', { full_name: 'octo/owned' }, { id: INSTALLATION_ID + 1 }],
      ['missing repository', undefined, { id: INSTALLATION_ID }],
      ['missing installation', { full_name: 'octo/owned' }, undefined],
      ['invalid installation', { full_name: 'octo/owned' }, { id: -1 }],
      ['string installation', { full_name: 'octo/owned' }, { id: String(INSTALLATION_ID) }],
    ])('ignores signed fix outcomes with %s', async (_label, repository, installation) => {
      const prUrl = `https://github.com/octo/owned/pull/${Math.floor(Math.random() * 100000000) + 1000}`
      const { findingId } = await seedFixFinding(
        `https://${randomBytes(8).toString('hex')}.example.com`,
        prUrl,
      )
      const before = verifyFixEnqueued.length
      for (const merged of [true, false]) {
        const body = JSON.stringify({
          action: 'closed',
          repository,
          installation,
          pull_request: { merged, html_url: prUrl },
        })
        expect((await webhook('pull_request', body, signWebhook(body))).statusCode).toBe(204)
      }
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ status: findings.status, prUrl: findings.prUrl })
          .from(findings)
          .where(eq(findings.id, findingId)),
      )
      expect(row).toEqual({ status: 'pr_open', prUrl })
      expect(verifyFixEnqueued.length).toBe(before)
      const events = await withTenant(db, tenantId, (tx) =>
        tx.execute(sql`select id from job_outbox where event_key = ${`verify-fix:${findingId}`}`),
      )
      expect(events.rows).toHaveLength(0)
    })

    it('serializes duplicate fix merge deliveries into one transition', async () => {
      const prUrl = 'https://github.com/octo/owned/pull/503'
      const { findingId } = await seedFixFinding('https://fixduplicate.example.com', prUrl)
      const before = verifyFixEnqueued.length
      const body = JSON.stringify({
        action: 'closed',
        repository: { full_name: 'octo/owned' },
        installation: { id: INSTALLATION_ID },
        pull_request: { merged: true, html_url: prUrl },
      })
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => webhook('pull_request', body, signWebhook(body))),
      )
      expect(responses.map((r) => r.statusCode)).toEqual([204, 204, 204])
      expect(verifyFixEnqueued.length).toBe(before + 1)
      const events = await withTenant(db, tenantId, (tx) =>
        tx.execute(sql`select id from job_outbox where event_key = ${`verify-fix:${findingId}`}`),
      )
      expect(events.rows).toHaveLength(1)
    })

    it('resets a finding to open when its fix PR is closed unmerged', async () => {
      const prUrl = 'https://github.com/octo/owned/pull/502'
      const before = verifyFixEnqueued.length
      const { findingId } = await seedFixFinding('https://fixclose.example.com', prUrl)

      const body = JSON.stringify({
        action: 'closed',
        repository: { full_name: 'octo/owned' },
        installation: { id: INSTALLATION_ID },
        pull_request: {
          merged: false,
          html_url: prUrl,
          head: { ref: 'seo-agent/TECH-007-0-canonical' },
        },
      })
      const res = await webhook('pull_request', body, signWebhook(body))

      expect(res.statusCode).toBe(204)
      // Closing unmerged verifies nothing.
      expect(verifyFixEnqueued.length).toBe(before)

      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ status: findings.status, prUrl: findings.prUrl })
          .from(findings)
          .where(eq(findings.id, findingId)),
      )
      expect(row?.status).toBe('open')
      expect(row?.prUrl).toBeNull()
    })
  })

  describe('the findings inbox', () => {
    let findingsSiteId: string

    /**
     * Hoisted out of the first test so every case here shares one fixture, and, more importantly,
     * so `priority_score` is set. Written directly, these rows would default to 0, every one would
     * tie, and the "most important first" assertion would be passing on the UUID tie-break rather
     * than on the ordering it claims to test.
     */
    beforeAll(async () => {
      findingsSiteId = await withTenant(db, tenantId, async (tx) => {
        const [s] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://findings.example.com' })
          .returning()
        return s!.id
      })

      const auditId = await withTenant(db, tenantId, async (tx) => {
        const [a] = await tx
          .insert(audits)
          .values({ tenantId, siteId: findingsSiteId, status: 'complete' })
          .returning()
        return a!.id
      })

      const evidence = {
        kind: 'markup' as const,
        url: 'https://findings.example.com/',
        locator: 'head',
        snippet: '',
        observedAt: '2026-07-17T00:00:00.000Z',
        source: 'crawler' as const,
      }

      const blocked = {
        severity: 'critical' as const,
        confidence: 1,
        estimatedImpact: 88,
        estimatedEffort: 'trivial' as const,
      }
      const thin = {
        severity: 'low' as const,
        confidence: 0.5,
        estimatedImpact: 20,
        estimatedEffort: 'large' as const,
      }

      await withTenant(db, tenantId, (tx) =>
        tx.insert(findings).values([
          {
            tenantId,
            siteId: findingsSiteId,
            auditId,
            ruleId: 'TECH-002',
            key: 'TECH-002#0',
            axis: 'crawl_health',
            title: 'AI crawler blocked',
            evidence,
            affectedUrls: ['https://findings.example.com/'],
            falsification: 'still blocked after merge',
            fixable: true,
            status: 'open',
            ...blocked,
            priorityScore: priorityScore(blocked),
          },
          {
            tenantId,
            siteId: findingsSiteId,
            auditId,
            ruleId: 'CONT-004',
            key: 'CONT-004#0',
            axis: 'content',
            title: 'Thin content on a page',
            evidence,
            affectedUrls: [],
            falsification: 'still thin after merge',
            fixable: false,
            status: 'open',
            ...thin,
            priorityScore: priorityScore(thin),
          },
        ]),
      )
    })

    it('lists the tenant findings from the latest audit, most important first', async () => {
      const res = await get(`/findings?siteId=${findingsSiteId}`, token)
      expect(res.statusCode).toBe(200)

      const body = res.json() as {
        findings: { ruleId: string; fixable: boolean }[]
        total: number
        page: number
        pageSize: number
      }

      // A page now, not a bare array: it carries the total so the UI can show a real count and
      // page numbers without downloading everything to work them out.
      expect(body).toMatchObject({ page: 1 })
      expect(body.total).toBe(2)

      // The cheap critical outranks the expensive low-impact one.
      expect(body.findings[0]).toMatchObject({ ruleId: 'TECH-002', fixable: true })
      expect(body.findings.find((f) => f.ruleId === 'CONT-004')).toMatchObject({ fixable: false })
    })

    it('reports whether a fix has been attempted and failed', async () => {
      // Without this the inbox cannot tell a finding whose fix was tried and failed from one
      // nobody has touched, which is the same mistake as not rendering status at all.
      const before = await get(`/findings?siteId=${findingsSiteId}`, token)
      expect((before.json() as { findings: { fixFailed: boolean }[] }).findings[0]).toMatchObject({
        fixFailed: false,
      })

      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({ fixError: 'No safe automatic fix could be generated for this finding.' })
          .where(eq(findings.ruleId, 'TECH-002')),
      )

      const after = await get(`/findings?siteId=${findingsSiteId}`, token)
      const row = (after.json() as { findings: { ruleId: string; fixFailed: boolean }[] }).findings
      expect(row.find((f) => f.ruleId === 'TECH-002')?.fixFailed).toBe(true)

      // A flag in the list, never the message: the same reasoning that took affectedUrls out of
      // this shape applies to a paragraph of error text on every row of every page.
      expect(JSON.stringify(row)).not.toContain('No safe automatic fix')
    })

    it('carries the reason on the finding itself, where there is room to read it', async () => {
      const listed = (
        (await get(`/findings?siteId=${findingsSiteId}`, token)).json() as {
          findings: { rowId: string; ruleId: string }[]
        }
      ).findings.find((f) => f.ruleId === 'TECH-002')

      const res = await get(`/findings/${listed?.rowId}`, token)
      expect(res.statusCode).toBe(200)
      expect((res.json() as { finding: { fixError?: string } }).finding.fixError).toContain(
        'No safe automatic fix',
      )
    })

    it('bounds a page and never returns more than asked for', async () => {
      const res = await get(`/findings?siteId=${findingsSiteId}&pageSize=1`, token)

      expect(res.json().findings).toHaveLength(1)
      expect(res.json().pageSize).toBe(1)
      // The total still describes the whole match, not the page.
      expect(res.json().total).toBe(2)
    })

    it('refuses a page size that would restore the unpaginated behaviour', async () => {
      // Without an upper bound, `?pageSize=100000` is the old endpoint wearing a query string and
      // the payload problem comes straight back.
      expect((await get('/findings?pageSize=100000', token)).statusCode).toBe(400)
    })

    it.each([
      ['severity', 'severity=critical', 1],
      ['axis', 'axis=content', 1],
      ['status', 'status=open', 2],
      ['fixable', 'fixable=true', 1],
      ['search', 'q=TECH-002', 1],
    ])('filters by %s on the server', async (_name, query, expected) => {
      const res = await get(`/findings?siteId=${findingsSiteId}&${query}`, token)

      expect(res.statusCode).toBe(200)
      expect(res.json().total).toBe(expected)
    })

    it('rejects a filter value that is not a real enum member', async () => {
      // Validated at the boundary, so a bad value is a 400 naming the field rather than a 500.
      expect((await get('/findings?severity=catastrophic', token)).statusCode).toBe(400)
      expect((await get('/findings?axis=vibes', token)).statusCode).toBe(400)
    })

    it('sends a count of affected pages, not the whole array', async () => {
      const res = await get(`/findings?siteId=${findingsSiteId}`, token)
      const first = res.json().findings[0]

      // The array was serialised into every inbox response for a column the list never rendered.
      expect(first).toHaveProperty('affectedUrlCount')
      expect(first).not.toHaveProperty('affectedUrls')
    })
  })

  describe('opening a fix pull request', () => {
    let repoSiteId: string
    let noRepoSiteId: string
    let fixableFindingId: string
    let unfixableFindingId: string
    let noRepoFindingId: string
    let retryFindingId: string

    const evidence = {
      kind: 'http' as const,
      url: 'https://www.example.com/',
      status: 200,
      redirectChain: ['https://example.com/'],
      observedAt: '2026-07-17T00:00:00.000Z',
      source: 'crawler' as const,
    }

    beforeAll(async () => {
      repoSiteId = await withTenant(db, tenantId, async (tx) => {
        const [s] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: 'https://fixable.example.com',
            repoFullName: 'octo/owned',
            githubInstallationId: INSTALLATION_ID,
          })
          .returning()
        return s!.id
      })
      noRepoSiteId = await withTenant(db, tenantId, async (tx) => {
        const [s] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://norepofix.example.com' })
          .returning()
        return s!.id
      })

      const auditFor = (siteId: string) =>
        withTenant(db, tenantId, async (tx) => {
          const [a] = await tx
            .insert(audits)
            .values({ tenantId, siteId, status: 'complete' })
            .returning()
          return a!.id
        })
      const repoAudit = await auditFor(repoSiteId)
      const noRepoAudit = await auditFor(noRepoSiteId)

      const insertFinding = (
        siteId: string,
        auditId: string,
        key: string,
        over: { fixable?: boolean } = {},
      ) =>
        withTenant(db, tenantId, async (tx) => {
          const [f] = await tx
            .insert(findings)
            .values({
              tenantId,
              siteId,
              auditId,
              ruleId: 'TECH-007',
              key,
              axis: 'crawl_health',
              severity: 'high',
              confidence: 1,
              title: 'a canonical that redirects',
              evidence,
              affectedUrls: ['https://example.com/about', 'https://example.com/'],
              estimatedEffort: 'trivial',
              estimatedImpact: 70,
              falsification: 'still redirects after merge',
              fixable: over.fixable ?? true,
              status: 'open',
            })
            .returning()
          return f!.id
        })

      fixableFindingId = await insertFinding(repoSiteId, repoAudit, 'TECH-007#0')
      unfixableFindingId = await insertFinding(repoSiteId, repoAudit, 'TECH-007#1', {
        fixable: false,
      })
      // Its own finding, so the retry case cannot disturb the ordering of the tests above.
      retryFindingId = await insertFinding(repoSiteId, repoAudit, 'TECH-007#2')
      noRepoFindingId = await insertFinding(noRepoSiteId, noRepoAudit, 'TECH-007#0')
    })

    it('queues a fix for a fixable finding on a repo-connected site', async () => {
      const before = fixEnqueued.length
      const res = await app.inject({
        method: 'POST',
        url: `/findings/${fixableFindingId}/fix`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(202)
      expect(res.json()).toEqual({ status: 'queued' })
      expect(fixEnqueued.length).toBe(before + 1)
      expect(fixEnqueued.at(-1)).toMatchObject({
        tenantId,
        siteId: repoSiteId,
        findingRowId: fixableFindingId,
      })
    })

    it('refuses a finding that cannot be fixed in code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/findings/${unfixableFindingId}/fix`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(409)
    })

    it('refuses a finding whose site has no repository connected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/findings/${noRepoFindingId}/fix`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(409)
    })

    it('gives another tenant a 404, not a 403, for a finding that is not theirs', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/findings/${fixableFindingId}/fix`,
        headers: { authorization: `Bearer ${otherToken}` },
      })
      expect(res.statusCode).toBe(404)
    })

    it('forgets the previous attempt’s error when a new fix is queued', async () => {
      /*
        The poll on the finding page reads "still open, and no error" as "in flight". If a failed
        attempt left its reason behind, a retry would look finished the instant it was queued, and
        the user would be shown the old failure as though it were the new one.
      */
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({ fixError: 'a previous attempt failed' })
          .where(eq(findings.id, retryFindingId)),
      )

      const res = await app.inject({
        method: 'POST',
        url: `/findings/${retryFindingId}/fix`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(202)

      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(findings).where(eq(findings.id, retryFindingId)).limit(1),
      )
      expect(row?.fixError).toBeNull()
    })

    it('rolls back the error reset when the durable fix request cannot be written', async () => {
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({ fixError: 'keep this failure' })
          .where(eq(findings.id, retryFindingId)),
      )
      const outbox = await import('@seo/db')
      const append = vi
        .spyOn(outbox, 'appendJob')
        .mockRejectedValueOnce(new Error('simulated outbox write failure'))
      const before = fixEnqueued.length
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/findings/${retryFindingId}/fix`,
          headers: { authorization: `Bearer ${token}` },
        })
        expect(response.statusCode).toBe(500)
      } finally {
        append.mockRestore()
      }
      expect(fixEnqueued.length).toBe(before)
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ fixError: findings.fixError })
          .from(findings)
          .where(eq(findings.id, retryFindingId)),
      )
      expect(row?.fixError).toBe('keep this failure')
    })

    it('keeps an accepted fix durable when immediate enqueue fails', async () => {
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({ fixError: 'previous failure' })
          .where(eq(findings.id, retryFindingId)),
      )
      const before = fixEnqueued.length
      failFixQueue = true
      try {
        const res = await app.inject({
          method: 'POST',
          url: `/findings/${retryFindingId}/fix`,
          headers: { authorization: `Bearer ${token}` },
        })
        expect(res.statusCode).toBe(202)
      } finally {
        failFixQueue = false
      }
      expect(fixEnqueued.length).toBe(before)
      const result = await withTenant(db, tenantId, (tx) =>
        tx.execute<{ payload: FixJob }>(sql`
        select payload from job_outbox where kind='fix' and payload->>'findingRowId'=${retryFindingId} order by created_at desc limit 1`),
      )
      expect(result.rows[0]?.payload).toMatchObject({
        tenantId,
        siteId: repoSiteId,
        findingRowId: retryFindingId,
        requestId: expect.any(String),
      })
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ fixError: findings.fixError })
          .from(findings)
          .where(eq(findings.id, retryFindingId)),
      )
      expect(row?.fixError).toBeNull()
    })

    it.each(['pr_open', 'merged', 'verified'] as const)(
      'does not regenerate a fix after it is %s',
      async (status) => {
        const { runFix } = await import('../../worker/src/fix.js')
        await withTenant(db, tenantId, (tx) =>
          tx
            .update(findings)
            .set({ status, fixError: null })
            .where(eq(findings.id, retryFindingId)),
        )
        try {
          await runFix(db, { tenantId, siteId: repoSiteId, findingRowId: retryFindingId })
          const [row] = await withTenant(db, tenantId, (tx) =>
            tx
              .select({ status: findings.status, fixError: findings.fixError })
              .from(findings)
              .where(eq(findings.id, retryFindingId)),
          )
          expect(row).toEqual({ status, fixError: null })
        } finally {
          await withTenant(db, tenantId, (tx) =>
            tx.update(findings).set({ status: 'open' }).where(eq(findings.id, retryFindingId)),
          )
        }
      },
    )

    it('adopts a PR a crashed attempt opened instead of generating another', async () => {
      const { runFix } = await import('../../worker/src/fix.js')
      const lookups: string[] = []
      const adopted = {
        url: 'https://github.com/octo/site/pull/41',
        number: 41,
        branch: `seo-agent/${retryFindingId}-missing-title`,
      }
      const provider = {
        findOpenPullRequest: async (_ctx: unknown, id: string) => {
          lookups.push(id)
          return adopted
        },
        getFile: async () => {
          throw new Error('must not read the repo when a PR already exists')
        },
        openPullRequest: async () => {
          throw new Error('must not open a second PR')
        },
      }
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({ status: 'open', fixError: 'died after opening the PR' })
          .where(eq(findings.id, retryFindingId)),
      )
      try {
        await runFix(
          db,
          { tenantId, siteId: repoSiteId, findingRowId: retryFindingId },
          { provider },
        )
        expect(lookups).toEqual([retryFindingId])
        const [row] = await withTenant(db, tenantId, (tx) =>
          tx
            .select({ status: findings.status, prUrl: findings.prUrl, fixError: findings.fixError })
            .from(findings)
            .where(eq(findings.id, retryFindingId)),
        )
        expect(row).toEqual({ status: 'pr_open', prUrl: adopted.url, fixError: null })
      } finally {
        await withTenant(db, tenantId, (tx) =>
          tx
            .update(findings)
            .set({ status: 'open', prUrl: null })
            .where(eq(findings.id, retryFindingId)),
        )
      }
    })

    it('refuses a second fix once one is already open', async () => {
      // Keep this last: it moves the finding out of `open`.
      await withTenant(db, tenantId, (tx) =>
        tx.update(findings).set({ status: 'pr_open' }).where(eq(findings.id, fixableFindingId)),
      )
      const res = await app.inject({
        method: 'POST',
        url: `/findings/${fixableFindingId}/fix`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(409)
    })
  })

  describe('watching a fix job', () => {
    let watchedId: string

    beforeAll(async () => {
      const siteId = await withTenant(db, tenantId, async (tx) => {
        const [s] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: 'https://fixwatch.example.com',
            repoFullName: 'octo/owned',
            githubInstallationId: INSTALLATION_ID,
          })
          .returning()
        return s!.id
      })
      const auditId = await withTenant(db, tenantId, async (tx) => {
        const [a] = await tx
          .insert(audits)
          .values({ tenantId, siteId, status: 'complete' })
          .returning()
        return a!.id
      })
      watchedId = await withTenant(db, tenantId, async (tx) => {
        const [f] = await tx
          .insert(findings)
          .values({
            tenantId,
            siteId,
            auditId,
            ruleId: 'TECH-007',
            key: 'TECH-007#0',
            axis: 'crawl_health',
            severity: 'high',
            confidence: 1,
            title: 'a canonical that redirects',
            evidence: {
              kind: 'http' as const,
              url: 'https://fixwatch.example.com/',
              status: 200,
              redirectChain: ['https://fixwatch.example.com'],
              observedAt: '2026-07-17T00:00:00.000Z',
              source: 'crawler' as const,
            },
            affectedUrls: ['https://fixwatch.example.com/'],
            estimatedEffort: 'trivial',
            estimatedImpact: 70,
            falsification: 'still redirects after merge',
            fixable: true,
            status: 'open',
          })
          .returning()
        return f!.id
      })
    })

    const progress = (id: string, bearer: string) =>
      app.inject({
        method: 'GET',
        url: `/findings/${id}/fix-progress`,
        headers: { authorization: `Bearer ${bearer}` },
      })

    it('says it is not finished while the job is still in flight', async () => {
      const res = await progress(watchedId, token)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        status: 'open',
        prUrl: null,
        fixError: null,
        finished: false,
      })
    })

    it('does not ship the finding’s evidence, because the point is to be small', async () => {
      // The whole reason this endpoint exists rather than polling GET /findings/:id.
      const res = await progress(watchedId, token)
      expect(JSON.stringify(res.json())).not.toContain('redirectChain')
      expect(Object.keys(res.json() as object).sort()).toEqual([
        'finished',
        'fixError',
        'id',
        'prUrl',
        'status',
      ])
    })

    it('finishes with the pull request once the worker has opened one', async () => {
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({ status: 'pr_open', prUrl: 'https://github.com/octo/owned/pull/7', fixError: null })
          .where(eq(findings.id, watchedId)),
      )

      const res = await progress(watchedId, token)
      expect(res.json()).toMatchObject({
        status: 'pr_open',
        prUrl: 'https://github.com/octo/owned/pull/7',
        finished: true,
      })
    })

    it('finishes with the reason when the attempt failed, so the poll stops', async () => {
      /*
        The failure case is the one that is invisible in the status column: the finding is still
        `open`, exactly as it was before the click. Without the error making it `finished`, the
        page would poll until it gave up and never say what went wrong.
      */
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(findings)
          .set({
            status: 'open',
            prUrl: null,
            fixError: 'No safe automatic fix could be generated.',
          })
          .where(eq(findings.id, watchedId)),
      )

      const res = await progress(watchedId, token)
      expect(res.json()).toMatchObject({
        status: 'open',
        finished: true,
        fixError: 'No safe automatic fix could be generated.',
      })
    })

    it('gives another tenant a 404, not a 403', async () => {
      const res = await progress(watchedId, otherToken)
      expect(res.statusCode).toBe(404)
    })
  })

  describe('drafting outreach', () => {
    let pitchSiteId: string

    const draft = {
      subject: 'Vehicle occupancy data for your Mara coverage',
      body: 'x'.repeat(200),
      angle: 'They covered the Mara circuit in March and used no occupancy figures.',
    }

    /** A model that returns a valid draft and records what it was asked. */
    const workingModel: OutreachLlm = {
      object: async (opts) => {
        outreachPrompts.push(opts.prompt)
        return { output: draft as never }
      },
    }

    beforeAll(async () => {
      pitchSiteId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://pitch.example.com', brand: 'Pitch Safaris' })
          .returning()
        return row!.id
      })
    })

    const pitch = (siteId: string, bearer: string, body: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/sites/${siteId}/outreach`,
        headers: { authorization: `Bearer ${bearer}` },
        payload: body,
      })

    const validBody = {
      domain: 'nation.africa',
      facts: [
        {
          claim: 'We have published vehicle occupancy for every 9-day Mara circuit since 2011.',
          sourceUrl: 'https://pitch.example.com/fleet',
        },
      ],
    }

    it('drafts a pitch, and says on the payload that a human sends it', async () => {
      outreachModel = workingModel
      const res = await pitch(pitchSiteId, token, validBody)

      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        draft: typeof draft
        sendPolicy: string
        groundedOn: { claim: string }[]
      }
      expect(body.draft.subject).toBe(draft.subject)
      expect(body.groundedOn).toHaveLength(1)
      // Rule 6 travels with the payload, so a UI cannot render a draft without the caveat.
      expect(body.sendPolicy).toContain('a human reviews and sends')
    })

    it('tells the model only the facts it was given', async () => {
      /*
        The expensive failure mode for this feature is an invented specific in an email to a
        journalist, sent under the client's name. The drafter's system prompt forbids inventing;
        this asserts the route is not quietly widening what the model has to work with.
      */
      outreachModel = workingModel
      outreachPrompts.length = 0
      await pitch(pitchSiteId, token, validBody)

      const prompt = outreachPrompts.at(-1) ?? ''
      expect(prompt).toContain('vehicle occupancy')
      expect(prompt).toContain('nation.africa')
      expect(prompt).toContain('Pitch Safaris')
    })

    it('answers 422, not 500, when the drafter refuses', async () => {
      // No chain configured, a refusal, or output that did not validate. None of those is a
      // fault the user can act on by retrying, and "there is no draft" is a real answer.
      outreachModel = {
        object: async () => {
          throw new Error('no chain configured')
        },
      }
      const res = await pitch(pitchSiteId, token, validBody)
      expect(res.statusCode).toBe(422)
    })

    it('refuses a request with no facts at all, before spending anything', async () => {
      outreachModel = workingModel
      outreachPrompts.length = 0
      const res = await pitch(pitchSiteId, token, { domain: 'nation.africa', facts: [] })

      expect(res.statusCode).toBe(400)
      expect(outreachPrompts).toHaveLength(0)
    })

    it('gives another tenant a 404, and does not call the model', async () => {
      outreachModel = workingModel
      outreachPrompts.length = 0
      const res = await pitch(pitchSiteId, otherToken, validBody)

      expect(res.statusCode).toBe(404)
      // The ownership check runs before the billed call, so a stranger cannot spend our money.
      expect(outreachPrompts).toHaveLength(0)
    })

    it('reports 503 when no model is configured at all', async () => {
      outreachModel = undefined
      const res = await pitch(pitchSiteId, token, validBody)
      expect(res.statusCode).toBe(503)
    })
  })

  describe('signing in with a social provider', () => {
    /** Pull the nonce the start route set, so the callback can present it like a browser would. */
    const nonceFrom = (setCookie: string | string[] | undefined): string => {
      const header = Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '')
      return header.split(';')[0]?.split('=')[1] ?? ''
    }

    const start = () => app.inject({ method: 'GET', url: '/auth/signin/fake' })

    /** Walk a whole sign-in and return the handoff code the browser would be redirected with. */
    const signIn = async (identity: SocialIdentity): Promise<string> => {
      nextIdentity = identity
      const started = await start()
      const nonce = nonceFrom(started.headers['set-cookie'])
      const state = new URL(started.headers.location as string).searchParams.get('state')

      const callback = await app.inject({
        method: 'GET',
        url: `/auth/signin/callback?code=ok&state=${encodeURIComponent(state ?? '')}`,
        headers: { cookie: `seo_signin_nonce=${nonce}` },
      })

      return new URL(callback.headers.location as string).searchParams.get('code') ?? ''
    }

    const redeem = async (code: string): Promise<string> => {
      const res = await app.inject({ method: 'POST', url: '/auth/exchange', payload: { code } })
      return (res.json() as { token: string }).token
    }

    const me = (session: string) =>
      app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${session}` },
      })

    it('lists only the providers that are configured', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/providers' })
      expect(res.json()).toEqual({ providers: ['fake'] })
    })

    it('sets a nonce cookie and sends the browser to the provider', async () => {
      const res = await start()

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toContain('https://provider.example/authorize')

      const cookie = String(res.headers['set-cookie'])
      expect(cookie).toContain('seo_signin_nonce=')
      // HttpOnly so no script can read it; Lax rather than Strict because the callback arrives
      // as a top-level navigation from the provider, and Strict would withhold it there.
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
    })

    it('refuses a callback whose nonce does not match the browser cookie', async () => {
      /*
        The login-CSRF defence. An attacker can obtain a valid code for their own account and feed
        the victim the callback URL; what they cannot do is set a cookie on our origin in the
        victim's browser. Without this the victim ends up signed into the attacker's account and
        typing their own data into it.
      */
      const started = await start()
      const state = new URL(started.headers.location as string).searchParams.get('state')

      const res = await app.inject({
        method: 'GET',
        url: `/auth/signin/callback?code=ok&state=${encodeURIComponent(state ?? '')}`,
        headers: { cookie: 'seo_signin_nonce=not-the-one' },
      })

      expect(res.headers.location).toContain('error=invalid_state')
    })

    it('refuses a callback with no cookie at all', async () => {
      const started = await start()
      const state = new URL(started.headers.location as string).searchParams.get('state')

      const res = await app.inject({
        method: 'GET',
        url: `/auth/signin/callback?code=ok&state=${encodeURIComponent(state ?? '')}`,
      })
      expect(res.headers.location).toContain('error=invalid_state')
    })

    it('refuses a forged state', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/signin/callback?code=ok&state=not.signed',
        headers: { cookie: 'seo_signin_nonce=whatever' },
      })
      expect(res.headers.location).toContain('error=invalid_state')
    })

    it('treats a declined consent as a choice, not a failure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/signin/callback?error=access_denied',
      })
      expect(res.headers.location).toContain('error=declined')
    })

    it('never puts the session token in the redirect, only a handoff code', async () => {
      /*
        The whole reason the handoff exists. A URL reaches browser history, the next request's
        Referer, and every log on the way, so a token in one is a credential written down in
        three places nobody controls.
      */
      const code = await signIn({ provider: 'fake', accountId: 'acct-redirect', name: 'R' })

      expect(code).not.toContain('seo_')
      expect(code.length).toBeGreaterThan(20)
    })

    it('exchanges the code for a token that actually works', async () => {
      const code = await signIn({ provider: 'fake', accountId: 'acct-works', name: 'W' })
      const session = await redeem(code)

      const whoami = await me(session)
      expect(whoami.statusCode).toBe(200)
      expect((whoami.json() as { identity: { name: string } }).identity).toMatchObject({
        provider: 'fake',
        name: 'W',
      })
    })

    it('spends a handoff code exactly once', async () => {
      // Reloading the callback URL is the ordinary way this happens, not an attack.
      const code = await signIn({ provider: 'fake', accountId: 'acct-once', name: 'O' })

      const first = await app.inject({ method: 'POST', url: '/auth/exchange', payload: { code } })
      const second = await app.inject({ method: 'POST', url: '/auth/exchange', payload: { code } })

      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(400)
    })

    it('refuses a code it never minted', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/exchange',
        payload: { code: 'not-a-real-code' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns the same tenant when the same account signs in again', async () => {
      /*
        Keyed on the provider account id, so this holds even when the email changes. Matching on
        the email instead would hand this person a second, empty tenant and lose everything in
        the first one.
      */
      const identity = { provider: 'fake', accountId: 'acct-stable', email: 'first@example.com' }
      const one = await signIn(identity)
      const two = await signIn({ ...identity, email: 'changed@example.com', name: 'Renamed' })

      await redeem(one)
      const after = await me(await redeem(two))
      const body = after.json() as { identity: { email: string; name: string } }

      // The display data refreshes from the provider rather than being frozen at first sign-in.
      expect(body.identity.email).toBe('changed@example.com')
      expect(body.identity.name).toBe('Renamed')

      const rows = await asOwner(db, (tx) =>
        tx.select().from(userIdentities).where(eq(userIdentities.providerAccountId, 'acct-stable')),
      )
      expect(rows).toHaveLength(1)
    })

    it('gives a hand-minted token a null identity rather than inventing one', async () => {
      const res = await me(token)
      expect((res.json() as { identity: unknown }).identity).toBeNull()
    })

    it('signing out revokes the token, not just the cookie', async () => {
      /*
        Clearing the cookie is what the user sees; deleting the row is what ends the session. With
        only the cookie cleared, a token captured beforehand keeps working for the full thirty
        days of the cookie's life after they believed they had signed out.
      */
      const session = await redeem(
        await signIn({ provider: 'fake', accountId: 'acct-signout', name: 'S' }),
      )
      expect((await me(session)).statusCode).toBe(200)

      await app.inject({
        method: 'POST',
        url: '/auth/signout',
        headers: { authorization: `Bearer ${session}` },
      })

      expect((await me(session)).statusCode).toBe(401)
    })

    it('leaves every other session alone when one signs out', async () => {
      // Signing out of this browser must not revoke the CLI token, or another browser.
      const first = await redeem(
        await signIn({ provider: 'fake', accountId: 'acct-two-devices', name: 'D' }),
      )
      const second = await redeem(
        await signIn({ provider: 'fake', accountId: 'acct-two-devices', name: 'D' }),
      )

      await app.inject({
        method: 'POST',
        url: '/auth/signout',
        headers: { authorization: `Bearer ${first}` },
      })

      expect((await me(second)).statusCode).toBe(200)
    })

    describe('managing sessions and tokens', () => {
      const call = (method: 'GET' | 'POST' | 'DELETE', url: string, bearer: string) =>
        app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` } })

      const sessionFor = async (accountId: string) =>
        redeem(await signIn({ provider: 'fake', accountId, name: 'T' }))

      it('mints a browser session with its kind and a thirty-day expiry', async () => {
        const session = await sessionFor('acct-session-kind')
        const [row] = await asOwner(db, (tx) =>
          tx
            .select()
            .from(apiTokens)
            .where(eq(apiTokens.tokenHash, hashToken(session))),
        )
        expect(row?.kind).toBe('session')
        const days = (row!.expiresAt!.getTime() - Date.now()) / 86_400_000
        expect(days).toBeGreaterThan(29.9)
        expect(days).toBeLessThanOrEqual(30)
      })

      it('lists live credentials, marks the current one, and never returns a hash', async () => {
        const first = await sessionFor('acct-list')
        const second = await sessionFor('acct-list')
        const res = await call('GET', '/auth/tokens', second)
        expect(res.statusCode).toBe(200)
        expect(res.body).not.toContain(hashToken(first))
        expect(res.body).not.toContain(hashToken(second))
        const { tokens } = res.json() as {
          tokens: { id: string; kind: string; current: boolean; expiresAt: string | null }[]
        }
        expect(tokens.filter((entry) => entry.current)).toHaveLength(1)
        expect(tokens.every((entry) => entry.kind === 'session' && entry.expiresAt)).toBe(true)
        expect(tokens.length).toBeGreaterThanOrEqual(2)
      })

      it('revokes one credential by id, and it stops working at once', async () => {
        const keeper = await sessionFor('acct-revoke-one')
        const doomed = await sessionFor('acct-revoke-one')
        const [row] = await asOwner(db, (tx) =>
          tx
            .select()
            .from(apiTokens)
            .where(eq(apiTokens.tokenHash, hashToken(doomed))),
        )
        const res = await call('DELETE', `/auth/tokens/${row!.id}`, keeper)
        expect(res.statusCode).toBe(204)
        expect((await me(doomed)).statusCode).toBe(401)
        expect((await me(keeper)).statusCode).toBe(200)
      })

      it('returns 404 for another tenant’s token and leaves it working', async () => {
        const mine = await sessionFor('acct-revoke-mine')
        const theirs = await sessionFor('acct-revoke-theirs')
        const [row] = await asOwner(db, (tx) =>
          tx
            .select()
            .from(apiTokens)
            .where(eq(apiTokens.tokenHash, hashToken(theirs))),
        )
        expect((await call('DELETE', `/auth/tokens/${row!.id}`, mine)).statusCode).toBe(404)
        expect((await me(theirs)).statusCode).toBe(200)
      })

      it('signs out everywhere else, sparing the caller and other tenants', async () => {
        const caller = await sessionFor('acct-everywhere')
        const laptop = await sessionFor('acct-everywhere')
        const bystander = await sessionFor('acct-everywhere-bystander')
        const res = await call('POST', '/auth/tokens/revoke-others', caller)
        expect(res.statusCode).toBe(200)
        expect((res.json() as { revoked: number }).revoked).toBeGreaterThanOrEqual(1)
        expect((await me(laptop)).statusCode).toBe(401)
        expect((await me(caller)).statusCode).toBe(200)
        expect((await me(bystander)).statusCode).toBe(200)
      })

      it('requires a credential for every token route', async () => {
        for (const [method, url] of [
          ['GET', '/auth/tokens'],
          ['POST', '/auth/tokens/revoke-others'],
          ['DELETE', '/auth/tokens/00000000-0000-0000-0000-000000000000'],
        ] as const) {
          expect((await app.inject({ method, url })).statusCode).toBe(401)
        }
      })
    })
  })

  describe('abandoned audits', () => {
    const HOUR = 60 * 60 * 1000

    const auditAt = (status: 'queued' | 'crawling' | 'complete', ageMs: number) =>
      withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(audits)
          .values({ tenantId, siteId, status, startedAt: new Date(Date.now() - ageMs) })
          .returning({ id: audits.id })
        return row!.id
      })

    const stateOf = async (id: string) => {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ status: audits.status, error: audits.error })
          .from(audits)
          .where(eq(audits.id, id)),
      )
      return row
    }

    it('fails an audit whose worker died, and leaves every live one alone', async () => {
      const { failAbandonedAudits } = await import('../../worker/src/abandoned-audits.js')
      const { createQueue, enqueueAudit } = await import('@seo/queue')

      const dead = await auditAt('crawling', 3 * HOUR)
      const retrying = await auditAt('crawling', 3 * HOUR)
      const recent = await auditAt('crawling', 10 * 60 * 1000)
      const waiting = await auditAt('queued', 3 * HOUR)
      const done = await auditAt('complete', 3 * HOUR)

      // A job pg-boss still holds, and a request the outbox has not published yet.
      const queue = await createQueue(url!)
      try {
        await enqueueAudit(queue, { auditId: retrying, tenantId, siteId, seed: 'https://x.test' })
        await asOwner(db, (tx) =>
          tx.execute(sql`insert into job_outbox (tenant_id, event_key, kind, payload)
            values (${tenantId}, ${`audit:${waiting}`}, 'audit', '{}'::jsonb)`),
        )

        await failAbandonedAudits(db)

        expect(await stateOf(dead)).toMatchObject({
          status: 'failed',
          error: expect.stringMatching(/worker stopped/),
        })
        expect((await stateOf(retrying))?.status).toBe('crawling')
        expect((await stateOf(recent))?.status).toBe('crawling')
        expect((await stateOf(waiting))?.status).toBe('queued')
        expect((await stateOf(done))?.status).toBe('complete')

        // Idempotent: a second sweep does not touch what the first one settled.
        const before = await stateOf(dead)
        await failAbandonedAudits(db)
        expect(await stateOf(dead)).toEqual(before)
      } finally {
        await asOwner(db, async (tx) => {
          await tx.execute(sql`delete from pgboss.job where id = ${retrying}`)
          await tx.execute(sql`delete from job_outbox where event_key = ${`audit:${waiting}`}`)
          for (const id of [dead, retrying, recent, waiting, done]) {
            await tx.delete(audits).where(eq(audits.id, id))
          }
        })
        await queue.stop({ graceful: false })
      }
    })
  })

  describe('verifying a site', () => {
    const verify = (siteId: string, bearer?: string) =>
      app.inject({
        method: 'POST',
        url: `/sites/${siteId}/verify`,
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      })

    it('returns 404 for a site that is not the caller’s', async () => {
      const res = await verify('00000000-0000-0000-0000-000000000000', token)
      expect(res.statusCode).toBe(404)
    })

    it('returns 409 when a verification PR is already open, without a second job', async () => {
      const openId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: 'https://vopen.example.com',
            repoFullName: 'octo/open',
            githubInstallationId: 55,
            gscVerificationStatus: 'pr_open',
          })
          .returning()
        return row!.id
      })

      const before = verifyEnqueued.length
      const res = await verify(openId, token)

      expect(res.statusCode).toBe(409)
      expect(verifyEnqueued.length).toBe(before)
    })

    it('returns 409 when the site has no connected repository', async () => {
      const bareId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://norepo.example.com' })
          .returning()
        return row!.id
      })
      const res = await verify(bareId, token)
      expect(res.statusCode).toBe(409)
    })

    it('queues the job when a repo and Google are both connected', async () => {
      // A site with a connected repo, and a Google credential for the tenant.
      const readyId = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: 'https://ready.example.com',
            repoFullName: 'octo/ready',
            githubInstallationId: 77,
          })
          .returning()
        return row!.id
      })
      await withTenant(db, tenantId, (tx) =>
        tx
          .insert(oauthCredentials)
          .values({ tenantId, provider: 'google', refreshTokenEncrypted: 'ciphertext' })
          .onConflictDoNothing(),
      )

      const res = await verify(readyId, token)

      expect(res.statusCode).toBe(202)
      expect(verifyEnqueued.at(-1)).toMatchObject({
        tenantId,
        siteId: readyId,
        requestId: expect.any(String),
      })
    })

    const readySite = async (host: string) => {
      const id = await withTenant(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({
            tenantId,
            url: `https://${host}`,
            repoFullName: `octo/${host}`,
            githubInstallationId: 77,
          })
          .returning()
        return row!.id
      })
      await withTenant(db, tenantId, (tx) =>
        tx
          .insert(oauthCredentials)
          .values({ tenantId, provider: 'google', refreshTokenEncrypted: 'ciphertext' })
          .onConflictDoNothing(),
      )
      return id
    }

    it('keeps an accepted verification durable when immediate enqueue fails', async () => {
      const siteRowId = await readySite('voutage.example.com')
      const before = verifyEnqueued.length
      failVerifyQueue = true
      try {
        expect((await verify(siteRowId, token)).statusCode).toBe(202)
      } finally {
        failVerifyQueue = false
      }
      expect(verifyEnqueued.length).toBe(before)
      const result = await withTenant(db, tenantId, (tx) =>
        tx.execute<{ event_key: string; payload: VerifyJob }>(sql`
        select event_key, payload from job_outbox where kind='verify' and payload->>'siteId'=${siteRowId}`),
      )
      expect(result.rows).toHaveLength(1)
      const payload = result.rows[0]!.payload
      expect(payload).toMatchObject({ tenantId, siteId: siteRowId, requestId: expect.any(String) })
      expect(result.rows[0]!.event_key).toBe(`verify:${payload.requestId}`)
    })

    it('returns 500 and enqueues nothing when the durable request cannot be written', async () => {
      const siteRowId = await readySite('vwritefail.example.com')
      const outbox = await import('@seo/db')
      const append = vi
        .spyOn(outbox, 'appendJob')
        .mockRejectedValueOnce(new Error('simulated outbox write failure'))
      const before = verifyEnqueued.length
      try {
        expect((await verify(siteRowId, token)).statusCode).toBe(500)
      } finally {
        append.mockRestore()
      }
      expect(verifyEnqueued.length).toBe(before)
    })

    it.each(['pr_open', 'merged', 'verified'] as const)(
      'does not reopen verification for a site that is %s',
      async (status) => {
        const { runVerify } = await import('../../worker/src/verify.js')
        const siteRowId = await readySite(`vskip-${status}.example.com`)
        await withTenant(db, tenantId, (tx) =>
          tx
            .update(sites)
            .set({ gscVerificationStatus: status, gscVerificationPrUrl: 'https://pr.example/1' })
            .where(eq(sites.id, siteRowId)),
        )
        // Resolves without touching Google or GitHub: neither is configured in this test.
        await runVerify(db, { tenantId, siteId: siteRowId })
        const [row] = await withTenant(db, tenantId, (tx) =>
          tx
            .select({ status: sites.gscVerificationStatus, pr: sites.gscVerificationPrUrl })
            .from(sites)
            .where(eq(sites.id, siteRowId)),
        )
        expect(row).toEqual({ status, pr: 'https://pr.example/1' })
      },
    )
  })

  /**
   * The prompts are the one input the AI-visibility axis cannot infer, so this is the door to the
   * whole axis. What matters here is less the round trip than the two things that would quietly
   * corrupt a measurement: a save that resets the history of questions the user did not touch,
   * and a competitor stored in a shape the citation parser can never match.
   */
  describe('AI-visibility prompts', () => {
    const putJson = (path: string, payload: unknown, bearer?: string) =>
      app.inject({
        method: 'PUT',
        url: path,
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
        payload: payload as object,
      })

    it('starts empty, which is a real state and not a missing one', async () => {
      const res = await get(`/sites/${siteId}/visibility`, token)

      expect(res.statusCode).toBe(200)
      // A null brand, not an empty string. "Nobody has told us" needs one spelling, or the
      // authority axis's "not measured" note ends up saying the wrong thing.
      expect(res.json()).toEqual({ prompts: [], competitors: [], brand: null })
    })

    it('saves prompts and reduces competitors to bare hosts', async () => {
      const res = await putJson(
        `/sites/${siteId}/visibility`,
        {
          prompts: ['  how much does a kenyan safari   cost  ', 'best safari operator in nairobi'],
          competitors: ['https://Rivalsafaris.com/pricing', 'www.anothertour.co.ke'],
          brand: 'Heartbeest Safaris',
        },
        token,
      )

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        // Trimmed, and the run of spaces collapsed. The question is unchanged.
        prompts: ['how much does a kenyan safari cost', 'best safari operator in nairobi'],
        // The parser matches on host, so a stored URL would never match anything.
        competitors: ['rivalsafaris.com', 'anothertour.co.ke'],
        brand: 'Heartbeest Safaris',
      })
    })

    it('stores a blank brand as null, so absent has one spelling', async () => {
      const res = await putJson(
        `/sites/${siteId}/visibility`,
        { prompts: [], competitors: [], brand: '   ' },
        token,
      )

      expect(res.json().brand).toBeNull()
    })

    it('drops a duplicate question rather than splitting one window into two half-samples', async () => {
      const res = await putJson(
        `/sites/${siteId}/visibility`,
        {
          prompts: ['How Much Does A Kenyan Safari Cost', 'how much does a kenyan safari cost'],
          competitors: [],
        },
        token,
      )

      expect(res.json().prompts).toEqual(['How Much Does A Kenyan Safari Cost'])
    })

    it('keeps the history of a question the user did not touch', async () => {
      await putJson(
        `/sites/${siteId}/visibility`,
        { prompts: ['a settled question'], competitors: [] },
        token,
      )

      const [prompt] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ id: visibilityPrompts.id })
          .from(visibilityPrompts)
          .where(eq(visibilityPrompts.siteId, siteId)),
      )

      await putJson(
        `/sites/${siteId}/visibility`,
        { prompts: ['a settled question', 'a brand new question'], competitors: [] },
        token,
      )

      const after = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ id: visibilityPrompts.id, prompt: visibilityPrompts.prompt })
          .from(visibilityPrompts)
          .where(eq(visibilityPrompts.siteId, siteId)),
      )

      // The same row, not a new one with the same text. A prompt owns its checks by foreign key,
      // so a delete-and-reinsert would cascade away every poll ever taken and silently reset a
      // window the user had already waited three days for.
      const settled = after.find((row) => row.prompt === 'a settled question')
      expect(settled?.id).toBe(prompt!.id)
      expect(after).toHaveLength(2)
    })

    it('names a competitor it could not read instead of silently dropping it', async () => {
      const res = await putJson(
        `/sites/${siteId}/visibility`,
        { prompts: [], competitors: ['rivalsafaris.com', 'not a domain'] },
        token,
      )

      // Dropping it quietly would leave a user watching a share of voice that omits the rival
      // they most wanted to track, with nothing on screen to explain why.
      expect(res.statusCode).toBe(400)
      expect(res.json().message).toContain('not a domain')
    })

    it('refuses more prompts than the cap, rather than trimming the list behind their back', async () => {
      const res = await putJson(
        `/sites/${siteId}/visibility`,
        {
          prompts: Array.from({ length: 21 }, (_, i) => `question number ${i}`),
          competitors: [],
        },
        token,
      )

      expect(res.statusCode).toBe(400)
    })

    it('is a 404 for another tenant, never a 403', async () => {
      const read = await get(`/sites/${siteId}/visibility`, otherToken)
      const write = await putJson(
        `/sites/${siteId}/visibility`,
        { prompts: ['stolen question'], competitors: [] },
        otherToken,
      )

      expect(read.statusCode).toBe(404)
      expect(write.statusCode).toBe(404)
    })

    it('needs a token like everything else', async () => {
      expect((await get(`/sites/${siteId}/visibility`)).statusCode).toBe(401)
    })
  })

  describe('the Google Business Profile', () => {
    /**
     * A Maps share link resolves through one redirect, so the app under test needs a fetch it can
     * be driven with. `location` is all the resolver reads, which is the property being relied on
     * here: the body is never downloaded.
     */
    const mapsApp = async (location: string | null) =>
      buildApp({
        db,
        mapsFetch: (async () =>
          ({
            ok: false,
            status: location ? 302 : 200,
            headers: new Headers(location ? { location } : {}),
          }) as Response) as unknown as typeof globalThis.fetch,
      })

    const put = (
      instance: Awaited<ReturnType<typeof buildApp>>,
      payload: unknown,
      bearer = token,
    ) =>
      instance.inject({
        method: 'PUT',
        url: `/sites/${siteId}/business-profile`,
        headers: { authorization: `Bearer ${bearer}` },
        payload: payload as object,
      })

    it('starts unconnected, which is a real state for a site that is not a local business', async () => {
      const res = await get(`/sites/${siteId}/business-profile`, token)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ cid: null, placeId: null, mapsUrl: null, reviewUrl: null })
    })

    it('follows a share link and stores what it carried', async () => {
      const instance = await mapsApp(
        'https://www.google.com/maps/place/Rangau/data=!4m2!3m1!1s0x182f0:0x4d2!19sChIJN1t_tDeuEmsRUsoyG83frY4',
      )

      try {
        const res = await put(instance, { mapsUrl: 'https://maps.app.goo.gl/abc123' })

        expect(res.statusCode).toBe(200)
        expect(res.json()).toEqual({
          cid: '1234',
          placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
          // The derived links travel with the stored ids so no caller has to know their shape.
          mapsUrl: 'https://maps.google.com/?cid=1234',
          reviewUrl:
            'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        })

        // And it survives the round trip, rather than only being echoed back.
        expect((await get(`/sites/${siteId}/business-profile`, token)).json().cid).toBe('1234')
      } finally {
        await instance.close()
      }
    })

    it('explains what to do when the link carries no business identifier', async () => {
      const instance = await mapsApp(null)

      try {
        const res = await put(instance, { mapsUrl: 'https://maps.app.goo.gl/nothing' })

        expect(res.statusCode).toBe(400)
        expect(res.json().message).toContain('press Share')
      } finally {
        await instance.close()
      }
    })

    it('refuses a link that redirects off Google, rather than fetching it', async () => {
      // The route takes a URL from a user, so this is the case that matters: a redirect to an
      // internal address must be refused at the hop, not followed.
      const instance = await mapsApp('http://169.254.169.254/latest/meta-data/')

      try {
        const res = await put(instance, { mapsUrl: 'https://maps.app.goo.gl/ssrf' })

        expect(res.statusCode).toBe(400)
        expect(res.json().message).toContain('off Google')
      } finally {
        await instance.close()
      }
    })

    it('disconnects on an empty value, so a wrong branch can be undone', async () => {
      const instance = await mapsApp('https://maps.google.com/?cid=99')

      try {
        await put(instance, { mapsUrl: 'https://maps.google.com/?cid=99' })
        const res = await put(instance, { mapsUrl: null })

        expect(res.json()).toEqual({ cid: null, placeId: null, mapsUrl: null, reviewUrl: null })
      } finally {
        await instance.close()
      }
    })

    it('is a 404 for another tenant, never a 403', async () => {
      const instance = await mapsApp('https://maps.google.com/?cid=99')

      try {
        expect((await get(`/sites/${siteId}/business-profile`, otherToken)).statusCode).toBe(404)
        expect(
          (await put(instance, { mapsUrl: 'https://maps.google.com/?cid=99' }, otherToken))
            .statusCode,
        ).toBe(404)
      } finally {
        await instance.close()
      }
    })

    it('needs a token like everything else', async () => {
      expect((await get(`/sites/${siteId}/business-profile`)).statusCode).toBe(401)
    })
  })

  describe('GET /keywords/ideas', () => {
    it('answers with a note and no data when no provider is configured', async () => {
      // The app under test is built without one. An unconfigured paid surface must be empty and
      // say why, never an error and never a zero: no keyword data is not the same as no demand.
      const response = await get('/keywords/ideas?seed=kenya%20safari', token)

      expect(response.statusCode).toBe(200)
      const body = response.json() as { ideas: unknown[]; note?: string }
      expect(body.ideas).toEqual([])
      expect(body.note).toMatch(/not configured/i)
    })

    it('requires a token like every other route', async () => {
      expect((await get('/keywords/ideas?seed=x')).statusCode).toBe(401)
    })

    it('rejects a missing seed rather than querying for nothing', async () => {
      expect((await get('/keywords/ideas', token)).statusCode).toBe(400)
    })

    it('rejects a limit above the ceiling, because rows are most of the bill', async () => {
      expect((await get('/keywords/ideas?seed=x&limit=5000', token)).statusCode).toBe(400)
    })

    describe('with a provider configured', () => {
      let configured: Awaited<ReturnType<typeof buildApp>>
      let seen: { seed: string; options?: { country?: string; limit?: number } }[]
      let gapCalls: {
        client: string
        competitor: string
        options?: { country?: string; limit?: number }
      }[]
      let askedFor: string[]
      let refuse: boolean

      beforeAll(async () => {
        seen = []
        gapCalls = []
        askedFor = []
        refuse = false

        configured = await buildApp({
          db,
          // A fake, so the route is exercised with no key, no network and no spend. What is under
          // test here is our wiring and our bounds, not the vendor.
          keywords: (forTenant) => {
            askedFor.push(forTenant)
            return {
              name: 'fake',
              ideas: async (seed, options) => {
                if (refuse) throw new KeywordBudgetError('the tenant is over its monthly budget')
                seen.push({ seed, ...(options ? { options } : {}) })
                return [{ keyword: `${seed} cost`, searchVolume: 2400, competition: 0.4, cpc: 1.2 }]
              },
              gap: async (client, competitor, options) => {
                if (refuse) throw new KeywordBudgetError('the tenant is over its monthly budget')
                gapCalls.push({ client, competitor, ...(options ? { options } : {}) })
                return {
                  client,
                  competitor,
                  limit: options?.limit ?? 25,
                  keywords: [
                    {
                      keyword: 'floor tiles nairobi',
                      searchVolume: 210,
                      competition: 0.8,
                      cpc: 0.12,
                      competitorPosition: 3,
                      competitorUrl: `https://${competitor}/tiles`,
                    },
                  ],
                }
              },
            }
          },
        })
      })

      afterAll(async () => {
        await configured?.close()
      })

      const ask = (query: string, bearer = token) =>
        configured.inject({
          method: 'GET',
          url: `/keywords/ideas?${query}`,
          headers: { authorization: `Bearer ${bearer}` },
        })

      it('returns the ideas and passes the market through', async () => {
        const response = await ask('seed=kenya%20safari&country=ke')

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
          seed: 'kenya safari',
          ideas: [{ keyword: 'kenya safari cost', searchVolume: 2400 }],
        })
        // Search volume is per-market; dropping the country would confidently measure the wrong one.
        expect(seen.at(-1)?.options?.country).toBe('ke')
      })

      it('applies a default limit rather than the vendor default, which costs more', async () => {
        await ask('seed=safari')
        expect(seen.at(-1)?.options?.limit).toBe(DEFAULT_KEYWORD_LIMIT)
      })

      it("builds the provider against the caller's own tenant, never a shared one", async () => {
        // The budget guard is per-tenant (ADR-0017), so a provider built for the wrong tenant
        // would spend somebody else's allowance and refuse the wrong caller.
        await ask('seed=safari', otherToken)
        expect(askedFor.at(-1)).toBe(otherTenantId)
      })

      it('reports a tenant over its cap as 429, not as a broken system', async () => {
        refuse = true
        const response = await ask('seed=safari')
        refuse = false

        // A quota answer about a working system. A 500 would send somebody debugging the vendor.
        expect(response.statusCode).toBe(429)
        expect(response.json()).toMatchObject({ error: 'Too Many Requests' })
        expect((response.json() as { message: string }).message).toMatch(/next calendar month/)
      })

      describe('the keyword gap', () => {
        const compare = (query: string, bearer = token) =>
          configured.inject({
            method: 'GET',
            url: `/sites/${siteId}/keywords/gap?${query}`,
            headers: { authorization: `Bearer ${bearer}` },
          })

        it('reads the competitor against this site', async () => {
          const response = await compare('competitor=rival.example&country=ke')

          expect(response.statusCode).toBe(200)
          expect(response.json()).toMatchObject({
            competitor: 'rival.example',
            keywords: [{ keyword: 'floor tiles nairobi', competitorPosition: 3 }],
          })
          // The client is the site, not something the caller can name: a gap between two domains
          // neither of which is yours is a comparison with no meaning here.
          expect(gapCalls.at(-1)?.client).toBe('https://owned.example.com')
          expect(gapCalls.at(-1)?.options?.country).toBe('ke')
        })

        it('says when the Search Console subtraction did not run, rather than implying a clean gap', async () => {
          // This tenant has no Google grant in this app instance, so nothing can be subtracted.
          // Reporting that plainly is the difference between a weak answer and a wrong one.
          const response = await compare('competitor=rival.example')

          expect(response.json().subtracted).toBeNull()
          expect((response.json() as { note: string }).note).toMatch(/not connected/)
        })

        it('applies a default limit rather than the vendor default', async () => {
          await compare('competitor=rival.example')
          expect(gapCalls.at(-1)?.options?.limit).toBe(DEFAULT_GAP_LIMIT)
        })

        it('is a 404 for another tenant, never a 403', async () => {
          expect((await compare('competitor=rival.example', otherToken)).statusCode).toBe(404)
        })

        it('answers a tenant over budget with 429, not 500', async () => {
          refuse = true
          const response = await compare('competitor=rival.example')
          refuse = false

          expect(response.statusCode).toBe(429)
        })
      })
    })
  })

  describe('mining questions', () => {
    /**
     * Search Console is not connected for this tenant in these tests, so the free half
     * contributes nothing and the route has to say so rather than return a bare empty list. What
     * is under test is the wiring and the honesty, not Google.
     */
    const askedFor: string[] = []

    const withSerp = (questions: string[] | Error) =>
      buildApp({
        db,
        serp: () => ({
          name: 'fake-serp',
          aiOverview: async (query: string) => ({ query, text: '', sources: [], present: false }),
          mentions: async (query: string) => ({ query, sources: [] }),
          relatedQuestions: async (query: string) => {
            askedFor.push(query)
            if (questions instanceof Error) throw questions
            return { query, questions }
          },
        }),
      })

    it('returns the free half and says the paid half was not asked', async () => {
      const response = await get(`/sites/${siteId}/questions`, token)

      expect(response.statusCode).toBe(200)
      expect(response.json().questions).toEqual([])
      expect((response.json() as { note: string }).note).toMatch(/Search Console/)
    })

    it('asks People Also Ask only when a subject is given', async () => {
      const app2 = await withSerp(['How much do floor tiles cost?'])
      try {
        const before = askedFor.length
        await app2.inject({
          method: 'GET',
          url: `/sites/${siteId}/questions`,
          headers: { authorization: `Bearer ${token}` },
        })
        // No seed, no paid query. The free half runs on its own and costs nothing.
        expect(askedFor).toHaveLength(before)

        const response = await app2.inject({
          method: 'GET',
          url: `/sites/${siteId}/questions?seed=floor%20tiles`,
          headers: { authorization: `Bearer ${token}` },
        })

        expect(askedFor.at(-1)).toBe('floor tiles')
        expect(response.json().questions).toEqual([
          {
            question: 'How much do floor tiles cost?',
            source: 'people-also-ask',
            variants: [],
          },
        ])
      } finally {
        await app2.close()
      }
    })

    it('says so when the SERP vendor is not configured, rather than failing', async () => {
      const response = await get(`/sites/${siteId}/questions?seed=tiles`, token)

      expect(response.statusCode).toBe(200)
      expect((response.json() as { note: string }).note).toMatch(/SERPAPI_API_KEY/)
    })

    it('keeps the free half when the paid half errors', async () => {
      const app2 = await withSerp(new Error('vendor down'))
      try {
        const response = await app2.inject({
          method: 'GET',
          url: `/sites/${siteId}/questions?seed=tiles`,
          headers: { authorization: `Bearer ${token}` },
        })

        expect(response.statusCode).toBe(200)
        expect((response.json() as { note: string }).note).toMatch(/did not answer/)
      } finally {
        await app2.close()
      }
    })

    it('is a 404 for another tenant, never a 403', async () => {
      expect((await get(`/sites/${siteId}/questions`, otherToken)).statusCode).toBe(404)
    })

    it('needs a token like everything else', async () => {
      expect((await get(`/sites/${siteId}/questions`)).statusCode).toBe(401)
    })
  })

  describe('finding places that might publish you', () => {
    /**
     * Mention building rather than link building, and the safety property is that a site selling
     * placements never reaches the opportunity list. These drive the route with a fake SERP
     * provider and no network.
     */
    const withSerp = (sources: { url: string; title: string }[]) =>
      buildApp({
        db,
        serp: () => ({
          name: 'fake-serp',
          aiOverview: async (query: string) => ({ query, text: '', sources: [], present: false }),
          relatedQuestions: async (query: string) => ({ query, questions: [] }),
          mentions: async (query: string) => ({ query, sources }),
        }),
        checkFetch: (async (input: string) =>
          new Response(
            input.includes('linkshop')
              ? '<h1>Write for us</h1><p>Guest post price: $80, dofollow link.</p>'
              : '<h1>Write for us</h1><p>We take pitches from the trade.</p>',
            { status: 200 },
          )) as unknown as typeof globalThis.fetch,
        checkResolve: (async () => [{ address: '93.184.216.34', family: 4 }]) as never,
      })

    const ask = (instance: Awaited<ReturnType<typeof buildApp>>, body: unknown, bearer = token) =>
      instance.inject({
        method: 'POST',
        url: `/sites/${siteId}/contributors`,
        headers: { authorization: `Bearer ${bearer}` },
        payload: body as object,
      })

    it('says so plainly when no SERP source is configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sites/${siteId}/contributors`,
        headers: { authorization: `Bearer ${token}` },
        payload: { niche: 'floor tiles' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ opportunities: [], refused: [], queriesRun: 0 })
      expect((response.json() as { note: string }).note).toMatch(/SERPAPI_API_KEY/)
    })

    it('keeps the publication and refuses the site selling placements', async () => {
      // The safety property, end to end through the route: a seller optimises for the same
      // phrase a publication uses, so the page itself has to be read before either is shown.
      const instance = await withSerp([
        { url: 'https://trade-journal.test/write-for-us', title: 'Write for us' },
        { url: 'https://linkshop.test/guest-posts', title: 'Guest posts' },
      ])

      try {
        const response = await ask(instance, { niche: 'floor tiles', locale: 'Kenya' })

        expect(response.statusCode).toBe(200)
        const body = response.json() as {
          opportunities: { domain: string }[]
          refused: { domain: string; matched: string[] }[]
        }

        expect(body.opportunities.map((entry) => entry.domain)).toEqual(['trade-journal.test'])
        expect(body.refused.map((entry) => entry.domain)).toEqual(['linkshop.test'])
        // Named with its evidence, so a client can disagree with the specific reason.
        expect(body.refused[0]?.matched.length).toBeGreaterThan(0)
      } finally {
        await instance.close()
      }
    })

    it('rejects a niche too short to search for', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sites/${siteId}/contributors`,
        headers: { authorization: `Bearer ${token}` },
        payload: { niche: 'x' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('is a 404 for another tenant, never a 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sites/${siteId}/contributors`,
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { niche: 'floor tiles' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('needs a token like everything else', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sites/${siteId}/contributors`,
        payload: { niche: 'floor tiles' },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe('the anonymous check', () => {
    /**
     * Clear this suite's own rate-limit history before asserting anything about limits.
     *
     * The limiter counts rows in a real database, so a suite that has run before today would
     * otherwise be refused by its own leftovers, which is exactly what happened when these tests
     * were first written. Scoped to the hash this process produces for 127.0.0.1, so it can never
     * touch a check somebody actually ran.
     */
    const clearMyChecks = async () => {
      const salt = process.env.TOKEN_ENCRYPTION_KEY ?? 'unsalted'
      const mine = createHash('sha256').update(`${salt}:127.0.0.1`).digest('hex')
      await asOwner(db, async (tx) => {
        await tx.delete(publicChecks).where(eq(publicChecks.ipHash, mine))
        await tx.execute(sql`delete from public_check_attempts where ip_hash = ${mine}`)
      })
    }

    beforeAll(clearMyChecks)

    /**
     * The one route in this API that runs with no tenant (ADR-0025). What these assert is the
     * boundary rather than the rule engine: that it needs no token, that it cannot be looped, and
     * that a refused URL comes back as something the visitor can act on.
     *
     * The network is never touched. `runQuickCheck` fetches through the SSRF guard, which has its
     * own tests; here the URL is always one the guard refuses, so the handler's error path is
     * exercised without a DNS lookup of somebody else's domain.
     */
    const check = (url: string) => app.inject({ method: 'POST', url: '/check', payload: { url } })

    it('needs no token at all, which is the entire point of it', async () => {
      const response = await check('http://example.com')

      // 400 because the URL is not https, not 401. Reaching the validation means the route let an
      // anonymous caller in.
      expect(response.statusCode).toBe(400)
      expect(response.json().message).toMatch(/https/)
    })

    it('refuses a URL that is not fetchable, with a reason a visitor can act on', async () => {
      const response = await check('https://localhost')

      expect(response.statusCode).toBe(400)
      expect(typeof response.json().message).toBe('string')
    })

    it('rejects a payload with no URL rather than checking nothing', async () => {
      const response = await app.inject({ method: 'POST', url: '/check', payload: {} })

      expect(response.statusCode).toBe(400)
    })

    it('answers 404 for a check id that does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/check/00000000-0000-4000-8000-00000000dead',
      })

      expect(response.statusCode).toBe(404)
    })

    it('rejects an id that is not a uuid, rather than querying with it', async () => {
      expect((await app.inject({ method: 'GET', url: '/check/not-a-uuid' })).statusCode).toBe(400)
    })

    describe('a check that actually runs', () => {
      /**
       * The happy path, with both the transport and DNS stubbed so no real site is fetched.
       *
       * It also proves something the RLS migration made non-obvious: `public_checks` has row-level
       * security forced and no policies at all, so the only role that can write it is the owner.
       * If these routes ever stopped using `asOwner`, this test would fail rather than the leak
       * being discovered in production.
       */
      const PAGE =
        '<!doctype html><html><head><title>A page</title></head>' +
        '<body><main><h1>A page</h1><p>Some words.</p></main></body></html>'

      const stubbed = async () =>
        buildApp({
          db,
          checkFetch: (async (input: string) => {
            if (input.endsWith('/robots.txt'))
              return new Response(['User-agent: *', 'Allow: /'].join('\n'), { status: 200 })
            if (input.endsWith('/llms.txt')) return new Response('', { status: 404 })
            if (input.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
            return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } })
          }) as unknown as typeof globalThis.fetch,
          checkResolve: (async () => [{ address: '93.184.216.34', family: 4 }]) as never,
          // The limiter counts rows in a shared database, so a suite run twice would otherwise
          // start failing on its own leftovers. The limits themselves are asserted below, with a
          // limit of one, which is a better test than waiting to hit the real five.
          checkLimits: { perIpDaily: 1000, globalDaily: 10_000 },
        })

      it('runs, stores the result, and reads it back by id', async () => {
        const instance = await stubbed()
        try {
          const ran = await instance.inject({
            method: 'POST',
            url: '/check',
            payload: { url: 'https://example.com/' },
          })

          expect(ran.statusCode).toBe(200)
          const body = ran.json() as { id: string; findings: unknown[]; limitations: string[] }
          expect(body.id).toBeTruthy()
          // The limitations are not decoration: a thin check that does not say what it skipped
          // reads as a clean bill of health.
          expect(body.limitations.length).toBeGreaterThan(0)

          const read = await instance.inject({ method: 'GET', url: `/check/${body.id}` })
          expect(read.statusCode).toBe(200)
          expect(read.json().finalUrl).toBe('https://example.com/')
        } finally {
          await instance.close()
        }
      })

      it('scores the axes it could not check as unmeasured rather than as passing', async () => {
        const instance = await stubbed()
        try {
          const ran = await instance.inject({
            method: 'POST',
            url: '/check',
            payload: { url: 'https://example.com/' },
          })

          const axes = (ran.json() as { scorecard: { axes: { axis: string; status: string }[] } })
            .scorecard.axes
          const performance = axes.find((axis) => axis.axis === 'performance')

          // Core Web Vitals need a connected account. An axis that quietly scored 100 here would
          // be the single most misleading thing on a free report.
          expect(performance?.status).toBe('not_measured')
        } finally {
          await instance.close()
        }
      })
    })

    it('refuses a sixth check from the same address, and says why', async () => {
      // The per-IP limit, driven with a limit of one so the assertion is about the mechanism
      // rather than about running five checks first.
      const instance = await buildApp({
        db,
        checkFetch: (async () =>
          new Response(
            '<html><head><title>x</title></head><body><main><h1>x</h1></main></body></html>',
            {
              status: 200,
            },
          )) as unknown as typeof globalThis.fetch,
        checkResolve: (async () => [{ address: '93.184.216.34', family: 4 }]) as never,
        checkLimits: { perIpDaily: 1, globalDaily: 10_000 },
      })

      try {
        // The tests above ran checks from this same address, and the limiter counts them.
        await clearMyChecks()

        const first = await instance.inject({
          method: 'POST',
          url: '/check',
          payload: { url: 'https://example.com/' },
        })
        expect(first.statusCode).toBe(200)

        const second = await instance.inject({
          method: 'POST',
          url: '/check',
          payload: { url: 'https://example.com/' },
        })

        expect(second.statusCode).toBe(429)
        // A quota answer about a working system, with somewhere to go next.
        expect((second.json() as { message: string }).message).toMatch(/sign in/i)
      } finally {
        await instance.close()
      }
    })

    describe('behind a reverse proxy', () => {
      const CLIENTS = ['127.0.0.1', '198.51.100.7', '198.51.100.8', '203.0.113.9', '93.184.216.34']
      const hashOf = (address: string) =>
        createHash('sha256')
          .update(`${process.env.TOKEN_ENCRYPTION_KEY ?? 'unsalted'}:${address}`)
          .digest('hex')
      const clear = () =>
        asOwner(db, async (tx) => {
          for (const address of CLIENTS) {
            await tx.delete(publicChecks).where(eq(publicChecks.ipHash, hashOf(address)))
            await tx.execute(
              sql`delete from public_check_attempts where ip_hash = ${hashOf(address)}`,
            )
          }
        })

      const withHops = (trustProxyHops: number) =>
        buildApp({
          db,
          trustProxyHops,
          checkFetch: (async () =>
            new Response('<html><head><title>x</title></head><body><h1>x</h1></body></html>', {
              status: 200,
            })) as unknown as typeof globalThis.fetch,
          checkResolve: (async () => [{ address: '93.184.216.34', family: 4 }]) as never,
          checkLimits: { perIpDaily: 1, globalDaily: 10_000 },
        })

      const check = (instance: Awaited<ReturnType<typeof buildApp>>, forwardedFor: string) =>
        instance.inject({
          method: 'POST',
          url: '/check',
          headers: { 'x-forwarded-for': forwardedFor },
          payload: { url: 'https://example.com/' },
        })

      it('keys on the hop our proxy wrote, so a spoofed prefix buys nothing', async () => {
        const instance = await withHops(1)
        await clear()
        try {
          expect((await check(instance, '198.51.100.7')).statusCode).toBe(200)
          // Same real client, pretending to be someone else by prepending an address.
          expect((await check(instance, '203.0.113.9, 198.51.100.7')).statusCode).toBe(429)
        } finally {
          await clear()
          await instance.close()
        }
      })

      it('gives each client behind the proxy its own quota', async () => {
        const instance = await withHops(1)
        await clear()
        try {
          expect((await check(instance, '198.51.100.7')).statusCode).toBe(200)
          expect((await check(instance, '198.51.100.8')).statusCode).toBe(200)
        } finally {
          await clear()
          await instance.close()
        }
      })

      it('ignores the header from a peer that is not on a private network', async () => {
        // A stranger connecting directly, claiming to be two different clients. Fastify's own
        // reason for refusing bare hop counts: nothing here is our proxy.
        const instance = await withHops(1)
        await clear()
        const direct = (forwardedFor: string) =>
          instance.inject({
            method: 'POST',
            url: '/check',
            remoteAddress: '93.184.216.34',
            headers: { 'x-forwarded-for': forwardedFor },
            payload: { url: 'https://example.com/' },
          })
        try {
          expect((await direct('198.51.100.7')).statusCode).toBe(200)
          expect((await direct('198.51.100.8')).statusCode).toBe(429)
        } finally {
          await clear()
          await instance.close()
        }
      })

      it('ignores the header entirely when no proxy is trusted', async () => {
        const instance = await withHops(0)
        await clear()
        try {
          expect((await check(instance, '198.51.100.7')).statusCode).toBe(200)
          // A different claimed address is still the same socket, so the same quota.
          expect((await check(instance, '198.51.100.8')).statusCode).toBe(429)
        } finally {
          await clear()
          await instance.close()
        }
      })

      it('reads the client from the chain Render actually sends, spoofed prefix and all', async () => {
        // Recorded from production (#199): the client wrote "1.2.3.4, 5.6.7.8"; Render appended
        // the real client, a Cloudflare edge and its load balancer, and a local proxy connected.
        const recorded = '1.2.3.4, 5.6.7.8,41.90.172.99, 172.71.146.118, 10.26.236.170'
        const instance = await buildApp({ db, trustProxyHops: 3 })
        instance.get('/whoami', async (request) => ({ ip: request.ip }))
        try {
          const res = await instance.inject({
            method: 'GET',
            url: '/whoami',
            headers: { 'x-forwarded-for': recorded },
          })
          expect(res.json()).toEqual({ ip: '41.90.172.99' })
        } finally {
          await instance.close()
        }
      })

      it.each([-1, 1.5, 6])('refuses to start with %s trusted hops', async (hops) => {
        await expect(buildApp({ db, trustProxyHops: hops })).rejects.toThrow(/trustProxyHops/)
      })
    })

    it('hides the prune route unless the caller knows the token', async () => {
      // A 404 rather than a 401: an endpoint that says "wrong token" has confirmed it exists.
      const response = await app.inject({
        method: 'DELETE',
        url: '/check/expired',
        headers: { 'x-prune-token': 'not-the-token' },
      })

      expect(response.statusCode).toBe(404)
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
