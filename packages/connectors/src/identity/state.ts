import { createHmac, randomBytes } from 'node:crypto'
import { safeEqual } from '../google/crypto.js'

/**
 * The signed state for a sign-in round trip.
 *
 * The Search Console flow's state carries a tenant id, because that flow starts from an
 * authenticated route and the whole point is to bind the eventual callback to the tenant that
 * began it. A sign-in has no tenant yet, by definition, so there is nothing of that kind to bind
 * to and a signature alone would prove only that *we* minted the state, not that this browser
 * did.
 *
 * So the state carries a nonce, and the start route drops the same nonce in a cookie on the
 * API's own origin. The callback accepts only a state whose nonce matches the cookie the browser
 * presents. That is what closes login CSRF: an attacker can obtain a valid authorization code for
 * their own account and feed the victim a callback URL, but they cannot write a cookie on our
 * origin in the victim's browser, so the nonces do not match and the sign-in is refused. Without
 * it the victim would end up signed into the attacker's account and typing their own data into
 * it.
 *
 * `SameSite=Lax` is correct for the cookie and worth stating, because `Strict` would break this:
 * the callback arrives as a top-level navigation from the provider's domain, which Lax allows
 * and Strict does not.
 */
const STATE_TTL_MS = 10 * 60 * 1000

export const SIGNIN_NONCE_COOKIE = 'seo_signin_nonce'

function stateSecret(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set; it also signs the sign-in state.')
  return Buffer.from(raw, 'base64')
}

const b64url = (value: Buffer | string): string =>
  (typeof value === 'string' ? Buffer.from(value) : value).toString('base64url')

export interface SigninState {
  provider: string
  nonce: string
  /** Where to send the browser afterwards, within the web app. Never an absolute URL. */
  next?: string
}

export function newNonce(): string {
  return randomBytes(24).toString('base64url')
}

export function signSigninState(state: SigninState, now = Date.now()): string {
  const payload = b64url(JSON.stringify({ ...state, iat: now }))
  const sig = b64url(createHmac('sha256', stateSecret()).update(payload).digest())
  return `${payload}.${sig}`
}

/**
 * Verify a sign-in state, or return undefined.
 *
 * Undefined always means reject. There is deliberately no partial success and no falling back to
 * a provider named by an unsigned query parameter: the provider is read from inside the signed
 * payload precisely so a caller cannot steer which one the code is redeemed against.
 */
export function verifySigninState(state: string, now = Date.now()): SigninState | undefined {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return undefined

  const expected = b64url(createHmac('sha256', stateSecret()).update(payload).digest())
  if (!safeEqual(sig, expected)) return undefined

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SigninState & {
      iat?: number
    }

    if (typeof parsed.provider !== 'string' || typeof parsed.nonce !== 'string') return undefined
    if (typeof parsed.iat !== 'number') return undefined
    if (now - parsed.iat > STATE_TTL_MS || parsed.iat > now + 60_000) return undefined

    return {
      provider: parsed.provider,
      nonce: parsed.nonce,
      ...(typeof parsed.next === 'string' ? { next: parsed.next } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * Pull one cookie out of a raw `Cookie` header.
 *
 * Hand-rolled rather than pulling in a cookie plugin, because this is the only cookie the API
 * ever reads and the whole need is one name and one opaque value. A dependency here would be a
 * supply-chain surface and a lockfile entry bought for four lines.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined

  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() !== name) continue

    return decodeURIComponent(part.slice(index + 1).trim())
  }

  return undefined
}

/**
 * Where the browser may be sent after a successful sign-in.
 *
 * Only a path, and only one that starts with a single slash. `//evil.example` is a
 * protocol-relative URL that a browser resolves to another origin, so the second character has
 * to be checked as well as the first, and that is the whole open-redirect class in two lines.
 */
export function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined
  if (!next.startsWith('/') || next.startsWith('//')) return undefined

  return next
}
