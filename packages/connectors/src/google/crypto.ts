import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Encrypt Google refresh tokens at rest.
 *
 * A refresh token is a live credential to someone else's Search Console, indefinitely, so it
 * is exactly the thing a database dump must not hand over in the clear (ADR-0003). We store
 * ciphertext and never the token, so the plaintext exists only in memory while a request is
 * in flight and never in a row, a backup, or a log line.
 *
 * AES-256-GCM, not AES-CBC or a bare cipher, because GCM authenticates as well as encrypts:
 * a tampered ciphertext fails to decrypt loudly rather than yielding quiet garbage that then
 * gets sent to Google as if it were a real token. The auth tag is what a test can flip a byte
 * against to prove the tampering is caught.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // GCM's standard nonce length.
const TAG_BYTES = 16

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32')
  }

  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256, got ${buf.length}. ` +
        'Generate one with: openssl rand -base64 32',
    )
  }
  return buf
}

/**
 * Returns a single base64 string: iv | auth tag | ciphertext. One opaque column value, with
 * everything decryption needs to find inside it, and a fresh random iv every time so the same
 * token never encrypts to the same bytes twice.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export function decryptToken(blob: string): string {
  const raw = Buffer.from(blob, 'base64')
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext is too short to be a valid encrypted token.')
  }

  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key(), iv)
  decipher.setAuthTag(tag)

  // `final()` throws if the auth tag does not match, which is how tampering is caught.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * A constant-time equality check, exported for the OAuth state HMAC comparison. Comparing
 * signatures with `===` leaks, through timing, how many leading bytes matched, which over
 * enough tries is enough to forge one. `timingSafeEqual` does not, but it throws on a length
 * mismatch, so guard that first.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}
