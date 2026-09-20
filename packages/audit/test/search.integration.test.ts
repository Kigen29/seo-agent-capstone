import { encryptToken, type OAuthConfig } from '@seo/connectors'
import {
  asOwner,
  createDb,
  oauthCredentials,
  sites,
  tenants,
  withTenant,
  type Database,
} from '@seo/db'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { measureSearch } from '../src/search.js'

/**
 * measureSearch reads a stored credential from Postgres and then talks to Google, so the
 * database half is real and the Google half is mocked: what is under test is our
 * orchestration (decrypt, refresh, match a property, evaluate), not Google's endpoints.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const CONFIG: OAuthConfig = {
  clientId: 'test.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:4000/auth/google/callback',
}

/**
 * A fetch that answers all three Google endpoints measureSearch touches, by URL: the token
 * refresh, the property list, and the search analytics query.
 */
const googleFetch = (
  rows: unknown[],
  properties = [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }],
) =>
  vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const u = String(input)
    const body = (data: unknown) =>
      ({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
      }) as Response

    if (u.includes('oauth2.googleapis.com/token'))
      return body({ access_token: 'access-1', expires_in: 3600 })
    if (u.endsWith('/sites')) return body({ siteEntry: properties })
    if (u.includes('/searchAnalytics/query')) {
      void init
      return body({ rows })
    }
    throw new Error(`unexpected fetch to ${u}`)
  })

/**
 * A fetch that answers each Search Analytics shape differently, keyed by the dimensions asked
 * for. measureSearch makes three of these calls now (query rows, query-and-page rows, and the
 * dimensionless totals), and a mock that returned one shape to all three would let a rule be
 * fed rows it never sees in production.
 */
const googleFetchByDimensions = (byKey: Record<string, unknown[]>) =>
  vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const u = String(input)
    const body = (data: unknown) =>
      ({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
      }) as Response

    if (u.includes('oauth2.googleapis.com/token'))
      return body({ access_token: 'access-1', expires_in: 3600 })
    if (u.endsWith('/sites'))
      return body({
        siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }],
      })
    if (u.includes('/searchAnalytics/query')) {
      const sent = JSON.parse(String(init?.body ?? '{}')) as { dimensions?: string[] }
      return body({ rows: byKey[(sent.dimensions ?? []).join(',')] ?? [] })
    }
    throw new Error(`unexpected fetch to ${u}`)
  })

describe.skipIf(!shouldRun)('measureSearch', () => {
  let db: Database
  let close: () => Promise<void>
  let tenantId: string
  let siteId: string

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    close = () => created.pool.end()

    tenantId = await asOwner(db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ name: `search-test-${Date.now()}` })
        .returning()
      return t!.id
    })

    siteId = await withTenant(db, tenantId, async (tx) => {
      const [s] = await tx
        .insert(sites)
        .values({ tenantId, url: 'https://example.com' })
        .returning()
      return s!.id
    })

    // A connected Google account: an encrypted refresh token, exactly as the OAuth callback
    // would have stored it.
    await withTenant(db, tenantId, (tx) =>
      tx.insert(oauthCredentials).values({
        tenantId,
        provider: 'google',
        accountEmail: 'owner@example.com',
        refreshTokenEncrypted: encryptToken('refresh-token-value'),
        scopes: ['webmasters'],
      }),
    )
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    await close()
  })

  const opts = () => ({ tenantId, siteId, siteUrl: 'https://example.com' })

  it('returns quick wins when the tenant is connected and the property matches', async () => {
    const fetch = googleFetch([
      { keys: ['seo audit'], clicks: 8, impressions: 3000, ctr: 0.0027, position: 13 },
    ])

    const result = await measureSearch(db, opts(), { config: CONFIG, fetch })

    expect(result.measured).toBe(true)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.ruleId).toBe('QW-STRIKING')
    expect(result.note).toMatch(/Search Console/)
  })

  it('finds pages competing for one query, from the query-and-page rows', async () => {
    const fetch = googleFetchByDimensions({
      query: [],
      'query,page': [
        {
          keys: ['floor tiles nairobi', 'https://example.com/tiles'],
          clicks: 10,
          impressions: 600,
          ctr: 0.016,
          position: 12,
        },
        {
          keys: ['floor tiles nairobi', 'https://example.com/flooring'],
          clicks: 2,
          impressions: 400,
          ctr: 0.005,
          position: 18,
        },
      ],
    })

    const result = await measureSearch(db, opts(), { config: CONFIG, fetch })

    expect(result.measured).toBe(true)
    expect(result.findings.map((f) => f.ruleId)).toEqual(['CONTENT-001'])
  })

  it('finds a question with no page answering it, using the crawled titles', async () => {
    const fetch = googleFetchByDimensions({
      query: [
        {
          keys: ['how much do floor tiles cost in nairobi'],
          clicks: 1,
          impressions: 300,
          ctr: 0.003,
          position: 31,
        },
      ],
      'query,page': [],
    })

    const withPages = {
      ...opts(),
      pages: [{ url: 'https://example.com/', title: 'Rangau Tiles', h1s: ['Rangau Tiles'] }],
    }

    const result = await measureSearch(db, withPages, { config: CONFIG, fetch })

    expect(result.findings.map((f) => f.ruleId)).toEqual(['CONTENT-002'])
  })

  it('keeps the quick wins when the query-and-page request fails', async () => {
    // A rate limit on the second request must not cost the audit the findings the first one
    // already produced. Cannibalisation is silently unmeasured; the rest still lands.
    const fetch = vi.fn(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        const u = String(input)
        const body = (data: unknown) =>
          ({
            ok: true,
            status: 200,
            json: async () => data,
            text: async () => JSON.stringify(data),
          }) as Response

        if (u.includes('oauth2.googleapis.com/token'))
          return body({ access_token: 'access-1', expires_in: 3600 })
        if (u.endsWith('/sites'))
          return body({
            siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }],
          })

        const sent = JSON.parse(String(init?.body ?? '{}')) as { dimensions?: string[] }
        if ((sent.dimensions ?? []).length === 2)
          return {
            ok: false,
            status: 429,
            json: async () => ({}),
            text: async () => 'slow down',
          } as Response

        return body({
          rows: [{ keys: ['seo audit'], clicks: 8, impressions: 3000, ctr: 0.0027, position: 13 }],
        })
      },
    )

    const result = await measureSearch(db, opts(), { config: CONFIG, fetch })

    expect(result.measured).toBe(true)
    expect(result.findings.map((f) => f.ruleId)).toEqual(['QW-STRIKING'])
  })

  it('decrypts the refresh token and trades it for an access token', async () => {
    // The token stored is ciphertext; the refresh call must send the decrypted value. Prove
    // the token endpoint was hit and the analytics call carried the resulting bearer.
    const fetch = googleFetch([])
    await measureSearch(db, opts(), { config: CONFIG, fetch })

    const tokenCall = fetch.mock.calls.find(([u]) => String(u).includes('oauth2.googleapis.com'))
    const analyticsCall = fetch.mock.calls.find(([u]) => String(u).includes('searchAnalytics'))
    expect(tokenCall).toBeTruthy()
    const authHeader = (analyticsCall![1] as RequestInit).headers as Record<string, string>
    expect(authHeader.authorization).toBe('Bearer access-1')
  })

  it('is honestly unmeasured, not failed, when Google is not configured', async () => {
    const result = await measureSearch(db, opts(), { config: undefined })

    expect(result).toMatchObject({ measured: false, findings: [] })
  })

  it('is honestly unmeasured when the tenant has not connected Google', async () => {
    // A different tenant, with no credential. The whole step must no-op rather than error.
    const other = await asOwner(db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ name: `no-google-${Date.now()}` })
        .returning()
      return t!.id
    })

    try {
      const result = await measureSearch(
        db,
        { tenantId: other, siteId, siteUrl: 'https://example.com' },
        { config: CONFIG, fetch: googleFetch([]) },
      )
      expect(result).toMatchObject({ measured: false, findings: [] })
    } finally {
      await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, other)))
    }
  })

  it('prefers the https property when a host has both http and https verified', async () => {
    // A tenant can have both verified. We should query the canonical https root, not whichever
    // the API happened to list first.
    const fetch = googleFetch(
      [{ keys: ['q'], clicks: 2, impressions: 2000, ctr: 0.001, position: 13 }],
      [
        { siteUrl: 'http://example.com/', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
      ],
    )

    const result = await measureSearch(db, opts(), { config: CONFIG, fetch })

    expect(result.measured).toBe(true)
    const analyticsCall = fetch.mock.calls.find(([u]) => String(u).includes('searchAnalytics'))
    expect(String(analyticsCall![0])).toContain(encodeURIComponent('https://example.com/'))
  })

  it('is honestly unmeasured when no verified property matches the site host', async () => {
    const fetch = googleFetch(
      [],
      [{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }],
    )

    const result = await measureSearch(db, opts(), { config: CONFIG, fetch })

    expect(result).toMatchObject({ measured: false, findings: [] })
  })

  it('is honestly unmeasured, not fatal, when the credential no longer refreshes', async () => {
    // Revoked or expired (Testing-mode tokens die after 7 days). The audit must not fail; the
    // other axes are real.
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      if (String(input).includes('oauth2.googleapis.com'))
        return {
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => 'invalid_grant',
        } as Response
      throw new Error('should not reach Search Console after a failed refresh')
    })

    const result = await measureSearch(db, opts(), { config: CONFIG, fetch })

    expect(result).toMatchObject({ measured: false, findings: [] })
  })
})
