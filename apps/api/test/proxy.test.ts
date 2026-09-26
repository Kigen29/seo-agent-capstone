import { describe, expect, it } from 'vitest'
import { trustedProxy } from '../src/proxy.js'

describe('trustedProxy', () => {
  it('trusts nothing at zero hops', () => {
    expect(trustedProxy(0)).toBe(false)
  })

  it.each([
    ['a private load balancer', '10.1.2.3', true],
    ['loopback', '127.0.0.1', true],
    ['an IPv4-mapped private peer', '::ffff:10.1.2.3', true],
    ['a public peer', '93.184.216.34', false],
    // Documentation ranges are not public either, so they are never taken for our proxy.
    ['a documentation-range peer', '203.0.113.9', true],
    ['a public IPv6 peer', '2606:2800:220:1::1', false],
    ['something that is not an address', 'not-an-ip', false],
  ])('decides the immediate peer when it is %s', (_label, address, trusted) => {
    const trust = trustedProxy(1) as (address: string, hop: number) => boolean
    expect(trust(address, 0)).toBe(trusted)
  })

  it('reads exactly the configured number of hops and no further', () => {
    const trust = trustedProxy(2) as (address: string, hop: number) => boolean
    expect(trust('10.0.0.1', 0)).toBe(true)
    expect(trust('198.51.100.1', 1)).toBe(true)
    expect(trust('198.51.100.2', 2)).toBe(false)
  })

  it.each([-1, 1.5, 6, Number.NaN])('refuses %s hops', (hops) => {
    expect(() => trustedProxy(hops)).toThrow(/trustProxyHops/)
  })
})
