import { describe, expect, it } from 'vitest'
import {
  signVisitorAddress,
  verifyVisitorAddress,
  VISITOR_ADDRESS_HEADER,
  VISITOR_SIGNATURE_HEADER,
  VISITOR_SIGNATURE_MAX_AGE_MS,
  VISITOR_TIME_HEADER,
} from '../src/visitor-address.js'

/**
 * A visitor's address, vouched for by the web app.
 *
 * Written as the things somebody would try in order to dodge a per-visitor limit, because that
 * is the only reason this exists: claim an address without the secret, reuse an old signature,
 * keep the signature and change the address.
 */
const SECRET = 'a-shared-secret-of-at-least-thirty-two-chars'
const NOW = 1_800_000_000_000

const unpack = (headers: Record<string, string>) => ({
  address: headers[VISITOR_ADDRESS_HEADER],
  time: headers[VISITOR_TIME_HEADER],
  signature: headers[VISITOR_SIGNATURE_HEADER],
})

describe('a visitor address the web app signed', () => {
  it('is accepted, for IPv4 and IPv6 alike', async () => {
    for (const address of ['203.0.113.7', '2001:db8::1']) {
      const headers = await signVisitorAddress(SECRET, address, NOW)
      expect(await verifyVisitorAddress(SECRET, unpack(headers), NOW + 1000)).toBe(address)
    }
  })

  it('is refused when the address is changed and the signature kept', async () => {
    const headers = unpack(await signVisitorAddress(SECRET, '203.0.113.7', NOW))

    expect(
      await verifyVisitorAddress(SECRET, { ...headers, address: '198.51.100.99' }, NOW),
    ).toBeNull()
  })

  it('is refused when the time is changed to make an old signature look new', async () => {
    const headers = unpack(await signVisitorAddress(SECRET, '203.0.113.7', NOW))
    const later = NOW + VISITOR_SIGNATURE_MAX_AGE_MS * 3

    expect(
      await verifyVisitorAddress(SECRET, { ...headers, time: String(later) }, later),
    ).toBeNull()
  })

  it('is refused once it is older than its lifetime', async () => {
    const headers = unpack(await signVisitorAddress(SECRET, '203.0.113.7', NOW))

    expect(
      await verifyVisitorAddress(SECRET, headers, NOW + VISITOR_SIGNATURE_MAX_AGE_MS + 1),
    ).toBeNull()
  })

  it('is refused when it is dated well into the future', async () => {
    const headers = unpack(await signVisitorAddress(SECRET, '203.0.113.7', NOW + 10 * 60_000))

    expect(await verifyVisitorAddress(SECRET, headers, NOW)).toBeNull()
  })

  it('is refused when it was signed with a different secret', async () => {
    const headers = unpack(
      await signVisitorAddress('another-secret-of-at-least-thirty-two-chars', '203.0.113.7', NOW),
    )

    expect(await verifyVisitorAddress(SECRET, headers, NOW)).toBeNull()
  })
})

describe('a visitor address nobody signed', () => {
  it('is refused, however it is dressed up', async () => {
    const time = String(NOW)
    for (const headers of [
      {},
      { address: '203.0.113.7' },
      { address: '203.0.113.7', time, signature: '' },
      { address: '203.0.113.7', time, signature: 'not-hex' },
      { address: '203.0.113.7', time, signature: 'ab'.repeat(32) },
      { address: ['203.0.113.7'], time, signature: 'ab'.repeat(32) },
      { address: '203.0.113.7', time: 'yesterday', signature: 'ab'.repeat(32) },
    ]) {
      expect(await verifyVisitorAddress(SECRET, headers, NOW)).toBeNull()
    }
  })

  it('is refused when the API has no secret, or one too short to be a secret', async () => {
    const headers = unpack(await signVisitorAddress(SECRET, '203.0.113.7', NOW))

    expect(await verifyVisitorAddress(undefined, headers, NOW)).toBeNull()
    expect(await verifyVisitorAddress('short', headers, NOW)).toBeNull()
  })
})

describe('signing', () => {
  it('sends nothing for something that is not an address', async () => {
    for (const address of ['', 'unknown', 'example.com/<script>', '203.0.113.7, 10.0.0.1']) {
      expect(await signVisitorAddress(SECRET, address, NOW)).toEqual({})
    }
  })

  it('sends nothing when the secret is too short to be one', async () => {
    expect(await signVisitorAddress('short', '203.0.113.7', NOW)).toEqual({})
  })
})
