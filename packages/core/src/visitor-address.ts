/**
 * A visitor's address, vouched for by the web app when it calls the API on their behalf.
 *
 * The web app makes its API calls from its own server. So for anything an anonymous visitor
 * does, the API sees the web server's address and not the visitor's, and every visitor in the
 * world shares one per-address allowance: one person using up the free check uses it up for
 * everybody.
 *
 * The web app knows the visitor's address and can pass it along, but the API cannot simply
 * believe a header, or anyone calling it directly could claim a fresh address for every request
 * and never be limited at all. So the web app signs what it passes with a secret the two share,
 * and the API accepts the address only when the signature checks out and is recent. Without the
 * secret on both sides nothing is sent and nothing is trusted, and the API falls back to the
 * address it can see, which is the behaviour before this existed.
 *
 * Web Crypto, not `node:crypto`, because this package is also bundled for the browser and a
 * Node-only import here would break that build. The signing itself only ever runs on a server.
 */
export const VISITOR_ADDRESS_HEADER = 'x-visitor-address'
export const VISITOR_TIME_HEADER = 'x-visitor-time'
export const VISITOR_SIGNATURE_HEADER = 'x-visitor-signature'

/** How long a signature is good for. Long enough for a slow cold start, too short to replay later. */
export const VISITOR_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

/** Shorter than this and it is a typo, not a secret. Generate one with: openssl rand -base64 32 */
export const VISITOR_SECRET_MIN_LENGTH = 32

/** An IPv4 or IPv6 address, loosely. This is a key for a counter, not something to connect to. */
const LOOKS_LIKE_AN_ADDRESS = /^[0-9a-f:.]{3,45}$/i

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

function fromHex(hex: string): Uint8Array | null {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

// The key type is left to be inferred: this package is compiled without the DOM library, where
// the name `CryptoKey` lives, and the runtime it describes is the same in Node and a browser.
const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    usage,
  ])

/** What is signed: the address and the time together, so neither can be swapped for another. */
const message = (address: string, time: string): Uint8Array => encoder.encode(`${address}\n${time}`)

/**
 * The headers the web app adds to a call it makes for a visitor. Empty when the address is not
 * one, so a caller can spread the result without checking.
 */
export async function signVisitorAddress(
  secret: string,
  address: string,
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const trimmed = address.trim()
  if (secret.length < VISITOR_SECRET_MIN_LENGTH || !LOOKS_LIKE_AN_ADDRESS.test(trimmed)) return {}

  const time = String(now)
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, 'sign'),
    message(trimmed, time),
  )

  return {
    [VISITOR_ADDRESS_HEADER]: trimmed,
    [VISITOR_TIME_HEADER]: time,
    [VISITOR_SIGNATURE_HEADER]: toHex(signature),
  }
}

/**
 * The visitor's address, if the headers carry one the web app really signed, and recently.
 * Null for anything else, and the caller then uses the address it can see for itself.
 *
 * The comparison is the platform's own `verify`, which takes the same time whether the first
 * byte is wrong or the last.
 */
export async function verifyVisitorAddress(
  secret: string | undefined,
  headers: { address?: unknown; time?: unknown; signature?: unknown },
  now: number = Date.now(),
): Promise<string | null> {
  if (!secret || secret.length < VISITOR_SECRET_MIN_LENGTH) return null

  const { address, time, signature } = headers
  if (typeof address !== 'string' || typeof time !== 'string' || typeof signature !== 'string') {
    return null
  }
  if (!LOOKS_LIKE_AN_ADDRESS.test(address) || !/^\d{10,16}$/.test(time)) return null

  // Old, or dated in the future beyond a little clock drift: either way, not to be believed.
  const age = now - Number(time)
  if (age > VISITOR_SIGNATURE_MAX_AGE_MS || age < -60_000) return null

  const given = fromHex(signature)
  if (!given) return null

  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret, 'verify'),
    given,
    message(address, time),
  )
  return valid ? address : null
}
