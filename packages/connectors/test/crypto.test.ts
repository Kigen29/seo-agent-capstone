import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptToken, encryptToken } from '../src/google/crypto.js'

/** A fixed, known key, so the test needs no .env and behaves identically in CI. */
const KEY = randomBytes(32).toString('base64')

describe('token encryption at rest', () => {
  let previous: string | undefined

  beforeAll(() => {
    previous = process.env.TOKEN_ENCRYPTION_KEY
    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })

  afterAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = previous
  })

  it('round-trips a refresh token', () => {
    const token = '1//0abcDEF-refresh-token_value.with-symbols'

    expect(decryptToken(encryptToken(token))).toBe(token)
  })

  it('never leaves the plaintext visible in the stored value', () => {
    // The whole point: a database dump must not hand over the token. If the ciphertext
    // contained the plaintext, encrypting it would be theatre.
    const token = 'super-secret-refresh-token'
    const blob = encryptToken(token)

    expect(blob).not.toContain(token)
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain(token)
  })

  it('produces different ciphertext each time, so equal tokens do not look equal at rest', () => {
    // A fresh random iv every time. Without it, two tenants who (somehow) held the same token
    // would have identical rows, leaking that fact to anyone reading the table.
    const token = 'the-same-token'

    expect(encryptToken(token)).not.toBe(encryptToken(token))
  })

  it('refuses to decrypt a tampered ciphertext, rather than returning quiet garbage', () => {
    // GCM authenticates. A flipped byte must fail loudly, because the alternative is handing
    // Google a corrupted token and getting an opaque auth error far from the real cause.
    const raw = Buffer.from(encryptToken('token'), 'base64')
    raw[20] ^= 0x01
    const tampered = raw.toString('base64')

    expect(() => decryptToken(tampered)).toThrow()
  })

  it('cannot be decrypted with a different key', () => {
    const blob = encryptToken('token')
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')

    expect(() => decryptToken(blob)).toThrow()

    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })

  it('rejects a key that is not 32 bytes, rather than encrypting weakly', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64')

    expect(() => encryptToken('token')).toThrow(/32 bytes/)

    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })
})
