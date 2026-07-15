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
