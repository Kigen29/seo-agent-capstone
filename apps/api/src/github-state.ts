import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Bind the GitHub App install redirect to a tenant and a site, the way the Google OAuth state
 * binds its callback to a tenant.
 *
 * When a user installs the App, GitHub sends them back to our setup URL as a plain browser
 * redirect carrying no bearer token. Taking the `installation_id` and applying it to whatever
 * site a query parameter named would let anyone attach their installation to another tenant's
 * site. So the start route mints an HMAC-signed state naming exactly the tenant and site it was
 * for, and the callback verifies the signature before it believes either.
 *
 * The site id is carried, not just the tenant, because installing is initiated from one
 * specific site card: the callback needs to know which site to write the installation onto,
 * and it must not take that from an unsigned parameter.
 *
 * Signed with TOKEN_ENCRYPTION_KEY, the same secret behind the Google state, and bounded by an
 * `iat` so a leaked or logged state cannot be replayed later.
 */

const STATE_TTL_MS = 10 * 60 * 1000

export interface GithubInstallState {
  tenantId: string
  siteId: string
}

function stateSecret(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set; it also signs the GitHub install state.')
  }
  return Buffer.from(raw, 'base64')
}

const b64url = (buf: Buffer | string): string =>
  (typeof buf === 'string' ? Buffer.from(buf) : buf).toString('base64url')

export function signInstallState(state: GithubInstallState, now = Date.now()): string {
  const payload = b64url(
    JSON.stringify({ tenantId: state.tenantId, siteId: state.siteId, iat: now }),
  )
  const sig = b64url(createHmac('sha256', stateSecret()).update(payload).digest())
  return `${payload}.${sig}`
}

/**
 * Verify a state and return the tenant and site it was minted for, or undefined if it is
 * forged, tampered with, or stale. Undefined always means reject.
 */
export function verifyInstallState(
  state: string,
  now = Date.now(),
): GithubInstallState | undefined {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return undefined

  const expected = b64url(createHmac('sha256', stateSecret()).update(payload).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined

  try {
    const { tenantId, siteId, iat } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof tenantId !== 'string' || typeof siteId !== 'string' || typeof iat !== 'number') {
      return undefined
    }
    if (now - iat > STATE_TTL_MS || iat > now + 60_000) return undefined
    return { tenantId, siteId }
  } catch {
    return undefined
  }
}
