import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  GoogleReauthRequiredError,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  signState,
  verifyState,
} from '../src/google/oauth.js'

const CONFIG = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:4000/auth/google/callback',
}

describe('OAuth state signing', () => {
  let previous: string | undefined

  beforeAll(() => {
    previous = process.env.TOKEN_ENCRYPTION_KEY
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })
  afterAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = previous
  })

  it('round-trips the tenant id through a signed state', () => {
    expect(verifyState(signState('tenant-abc'))).toBe('tenant-abc')
  })

  it('rejects a forged state, so a caller cannot name any tenant it likes', () => {
    // The failure this exists to prevent: the callback has no bearer token, so if it trusted
    // an unsigned tenant id from the query string, anyone could connect their Google account
    // to any tenant. A tampered signature must not verify.
    const good = signState('tenant-abc')
    const forged = good.slice(0, -3) + 'xxx'

    expect(verifyState(forged)).toBeUndefined()
  })

  it('rejects a state whose payload was swapped under a stolen signature', () => {
    const sig = signState('victim-tenant').split('.')[1]!
    const attackerPayload = Buffer.from(
      JSON.stringify({ tenantId: 'attacker', iat: Date.now() }),
    ).toString('base64url')

    expect(verifyState(`${attackerPayload}.${sig}`)).toBeUndefined()
  })

  it('rejects a stale state, so a leaked one cannot be replayed later', () => {
    const old = signState('tenant-abc', Date.now() - 11 * 60 * 1000)

    expect(verifyState(old)).toBeUndefined()
  })

  it('rejects a malformed state without throwing', () => {
    expect(verifyState('not-a-state')).toBeUndefined()
    expect(verifyState('')).toBeUndefined()
  })
})

describe('buildAuthUrl', () => {
  it('asks for offline access and forces consent, or no refresh token is ever issued', () => {
    // Without access_type=offline and prompt=consent, Google returns no refresh token, and a
    // background audit could then only run while the user is present, which defeats the point.
    const url = new URL(buildAuthUrl(CONFIG, 'state123'))

    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('state123')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('requests the Search Console and site-verification scopes', () => {
    const scope = new URL(buildAuthUrl(CONFIG, 's')).searchParams.get('scope') ?? ''

    expect(scope).toContain('webmasters')
    expect(scope).toContain('siteverification')
  })
})

const jsonResponse = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)

/** A minimal id_token: header.payload.signature, payload carrying an email claim. */
const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`

describe('exchangeCode', () => {
  it('returns the refresh token, access token, and the consenting email', async () => {
    const fetch = jsonResponse(200, {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      id_token: idToken('owner@example.com'),
    })

    const result = await exchangeCode(CONFIG, 'auth-code', fetch)

    expect(result.refreshToken).toBe('refresh-1')
    expect(result.accessToken).toBe('access-1')
    expect(result.email).toBe('owner@example.com')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  it('throws when Google returns no refresh token, rather than storing an empty one', async () => {
    // A refresh token absent here means a silent failure weeks later when the background audit
    // has nothing to refresh. Fail now, loudly, where the cause is obvious.
    const fetch = jsonResponse(200, { access_token: 'a', expires_in: 3600 })

    await expect(exchangeCode(CONFIG, 'code', fetch)).rejects.toThrow(/refresh token/i)
  })

  it('throws on a non-200 from the token endpoint', async () => {
    const fetch = jsonResponse(400, { error: 'invalid_grant' })

    await expect(exchangeCode(CONFIG, 'code', fetch)).rejects.toThrow(/400/)
  })
})

describe('refreshAccessToken', () => {
  it('trades a refresh token for a fresh access token', async () => {
    const fetch = jsonResponse(200, { access_token: 'access-2', expires_in: 3600 })

    const result = await refreshAccessToken(CONFIG, 'refresh-1', fetch)

    expect(result.accessToken).toBe('access-2')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  it('says the grant itself is dead when Google answers invalid_grant, so the caller can record it', async () => {
    // The user revoked us, or the token expired (7 days while the OAuth client is in Testing).
    // No retry changes that, so it is its own error and not one more failed request (ADR-0048).
    const fetch = jsonResponse(400, { error: 'invalid_grant', error_description: 'Token expired' })

    const failure = await refreshAccessToken(CONFIG, 'refresh-1', fetch).catch((error) => error)
    expect(failure).toBeInstanceOf(GoogleReauthRequiredError)
    // Nothing of Google's own wording, which a caller might otherwise put on a page.
    expect(String(failure.message)).not.toContain('Token expired')
  })

  it('does not call any other failure a dead grant', async () => {
    // A bad request of our own, an outage and a rate limit all leave the grant as good as it was.
    for (const [status, body] of [
      [400, { error: 'invalid_request' }],
      [500, { error: 'internal_failure' }],
      [503, { error: 'backend_error' }],
      [429, { error: 'rate_limit_exceeded' }],
    ] as const) {
      const failure = await refreshAccessToken(
        CONFIG,
        'refresh-1',
        jsonResponse(status, body),
      ).catch((error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure).not.toBeInstanceOf(GoogleReauthRequiredError)
      expect(String(failure.message)).toContain(String(status))
    }
  })
})
