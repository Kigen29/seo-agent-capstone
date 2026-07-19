import { decryptToken, signState } from '@seo/connectors'
import {
  apiTokens,
  asOwner,
  audits,
  createDb,
  findings,
  oauthCredentials,
  sites,
  tenants,
  withTenant,
  type Database,
} from '@seo/db'
import type { AuditJob, ConfirmVerifyJob, FixJob, VerifyFixJob, VerifyJob } from '@seo/queue'
import type { InstalledRepo } from '@seo/vcs'
import { createHmac, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
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
  const verifyFixEnqueued: VerifyFixJob[] = []

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
        verifyEnqueued.push(job)
      },
      enqueueConfirmVerify: async (job) => {
        confirmEnqueued.push(job)
      },
      enqueueFix: async (job) => {
        fixEnqueued.push(job)
      },
      enqueueVerifyFix: async (job) => {
        verifyFixEnqueued.push(job)
      },
      github: {
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
      const state = signInstallState({ tenantId, siteId })
      const res = await app.inject({
        method: 'GET',
        url:
          `/connections/github/callback?installation_id=${INSTALLATION_ID}` +
          `&setup_action=install&state=${encodeURIComponent(state)}`,
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
      expect(body.manageUrl).toContain(`installations/${INSTALLATION_ID}`)

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
          })
          .returning()
        return row!.id
      })

      const body = JSON.stringify({
        action: 'closed',
        pull_request: {
          merged: true,
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
            gscVerificationStatus: 'pr_open',
            gscVerificationPrUrl: 'https://github.com/o/r/pull/1',
          })
          .returning()
        return row!.id
      })

      const body = JSON.stringify({
        action: 'closed',
        pull_request: { merged: false, head: { ref: `seo-agent/AGENT-VERIFY-${closedId}-t1-x` } },
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

    it('resets a finding to open when its fix PR is closed unmerged', async () => {
      const prUrl = 'https://github.com/octo/owned/pull/502'
      const before = verifyFixEnqueued.length
      const { findingId } = await seedFixFinding('https://fixclose.example.com', prUrl)

      const body = JSON.stringify({
        action: 'closed',
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
    it('lists the tenant findings from the latest audit, most important first', async () => {
      const fsiteId = await withTenant(db, tenantId, async (tx) => {
        const [s] = await tx
          .insert(sites)
          .values({ tenantId, url: 'https://findings.example.com' })
          .returning()
        return s!.id
      })
      const auditId = await withTenant(db, tenantId, async (tx) => {
        const [a] = await tx
          .insert(audits)
          .values({ tenantId, siteId: fsiteId, status: 'complete' })
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
      await withTenant(db, tenantId, (tx) =>
        tx.insert(findings).values([
          {
            tenantId,
            siteId: fsiteId,
            auditId,
            ruleId: 'TECH-002',
            key: 'TECH-002#0',
            axis: 'crawl_health',
            severity: 'critical',
            confidence: 1,
            title: 'AI crawler blocked',
            evidence,
            affectedUrls: ['https://findings.example.com/'],
            estimatedEffort: 'trivial',
            estimatedImpact: 88,
            falsification: 'still blocked after merge',
            fixable: true,
            status: 'open',
          },
          {
            tenantId,
            siteId: fsiteId,
            auditId,
            ruleId: 'CONT-004',
            key: 'CONT-004#0',
            axis: 'content',
            severity: 'low',
            confidence: 0.5,
            title: 'Thin content on a page',
            evidence,
            affectedUrls: [],
            estimatedEffort: 'large',
            estimatedImpact: 20,
            falsification: 'still thin after merge',
            fixable: false,
            status: 'open',
          },
        ]),
      )

      const res = await get('/findings', token)
      expect(res.statusCode).toBe(200)

      const list = res.json().findings as { ruleId: string; fixable: boolean; siteUrl: string }[]
      const mine = list.filter((f) => f.siteUrl === 'https://findings.example.com')
      // The cheap critical outranks the expensive low-impact one.
      expect(mine[0]).toMatchObject({ ruleId: 'TECH-002', fixable: true })
      expect(mine.find((f) => f.ruleId === 'CONT-004')).toMatchObject({ fixable: false })
    })
  })

  describe('opening a fix pull request', () => {
    let repoSiteId: string
    let noRepoSiteId: string
    let fixableFindingId: string
    let unfixableFindingId: string
    let noRepoFindingId: string

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
      expect(verifyEnqueued.at(-1)).toMatchObject({ tenantId, siteId: readyId })
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
