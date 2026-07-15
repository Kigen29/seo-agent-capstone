import { createHmac } from 'node:crypto'
import { safeEqual } from './crypto.js'

/**
 * Google OAuth, per tenant, with the tenant's own consent (ADR-0003). Never a service
 * account, which would need a manual per-property grant and is the leading cause of mystery
 * 403s; and never a password, which would get the OAuth client banned.
 *
 * The scopes are requested once, up front: `webmasters` (read Search Analytics now, and
 * `sites.add` for sprint 2's auto-verification) and `siteverification` (complete that
 * verification). Asking for both now means the killer feature needs no second consent later.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification',
  'openid',
  'email',
]

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** How long a signed state is accepted after it is minted. The consent screen is quick. */
const STATE_TTL_MS = 10 * 60 * 1000

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function googleOAuthConfigFromEnv(): OAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ' +
        'GOOGLE_OAUTH_REDIRECT_URI.',
    )
  }
  return { clientId, clientSecret, redirectUri }
}

/**
 * Sign which tenant a consent belongs to, so the callback can trust it.
 *
 * The OAuth callback arrives as a browser redirect from Google, carrying no bearer token, so
 * it has no other way to know which tenant just consented. Taking a `tenantId` query
 * parameter at face value would let anyone connect their own Google account to any tenant
 * they name. The state is an HMAC-signed token instead: only this server can mint one, and
 * the callback verifies the signature before it believes the tenant id inside it.
 *
 * `iat` bounds the window, so a leaked or logged state cannot be replayed a week later.
 */
function stateSecret(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set; it also signs the OAuth state.')
  return Buffer.from(raw, 'base64')
}

const b64url = (buf: Buffer | string): string =>
  (typeof buf === 'string' ? Buffer.from(buf) : buf).toString('base64url')

export function signState(tenantId: string, now = Date.now()): string {
  const payload = b64url(JSON.stringify({ tenantId, iat: now }))
  const sig = b64url(createHmac('sha256', stateSecret()).update(payload).digest())
  return `${payload}.${sig}`
}

/**
 * Verify a state and return the tenant it was minted for, or undefined if it is forged,
 * tampered with, or stale. Undefined always means "reject": the caller must not fall back to
 * any tenant id it can find elsewhere.
 */
export function verifyState(state: string, now = Date.now()): string | undefined {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return undefined

  const expected = b64url(createHmac('sha256', stateSecret()).update(payload).digest())
  if (!safeEqual(sig, expected)) return undefined

  try {
    const { tenantId, iat } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof tenantId !== 'string' || typeof iat !== 'number') return undefined
    if (now - iat > STATE_TTL_MS || iat > now + 60_000) return undefined
    return tenantId
  } catch {
    return undefined
  }
}

/** The consent URL to send the user to. `state` binds the eventual callback to a tenant. */
export function buildAuthUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent is what actually yields a refresh token: Google withholds one on a
    // repeat consent unless we force the prompt, and without it we could only ever act while
    // the user is present, which is useless for a background audit.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface TokenResponse {
  refreshToken: string
  accessToken: string
  /** Epoch ms when the access token stops working. */
  expiresAt: number
  /** The Google account that consented, for the UI to show and the user to revoke. */
  email?: string
}

interface GoogleTokenBody {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
}

/** Pull the email out of the id_token without verifying it: it came straight from Google's
 * token endpoint over TLS, so its provenance is not in question, only its contents are read. */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined
  const payload = idToken.split('.')[1]
  if (!payload) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof claims.email === 'string' ? claims.email : undefined
  } catch {
    return undefined
  }
}

/**
 * Exchange the one-time authorization code for tokens.
 *
 * The refresh token is the prize: it is what lets a background audit read Search Console
 * weeks later without the user present. Google only returns one when `access_type=offline`
 * and `prompt=consent` were set on the auth URL, so its absence here is treated as a hard
 * error rather than stored as an empty string that fails silently later.
 */
export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Google token exchange failed: ${response.status} ${body.slice(0, 200)}`)
  }

  const data = (await response.json()) as GoogleTokenBody

  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. The user may have consented before; ' +
        'prompt=consent should force a new one.',
    )
  }

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: emailFromIdToken(data.id_token),
  }
}

/** Trade a stored refresh token for a fresh access token, just before calling an API. */
export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // A 400 here usually means the user revoked us, or the token expired in Testing mode
    // (7 days). Either way the tenant must re-consent, and the caller should surface that.
    throw new Error(`Google token refresh failed: ${response.status} ${body.slice(0, 200)}`)
  }

  const data = (await response.json()) as GoogleTokenBody
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
}
