import { isIP } from 'node:net'
import { isPrivateAddress } from '@seo/core'

/**
 * Which X-Forwarded-For hops to believe, for Fastify's `trustProxy`.
 *
 * Fastify 5 deliberately ignores a bare hop count: a count alone cannot tell whether the machine
 * connected to us is our proxy or a stranger who wrote a long header, so it fails closed. This adds
 * the missing check. The immediate peer is trusted only when it is on a private network, which is
 * where a platform load balancer connects from and where no internet client can; past that peer,
 * `hops` entries are read from the right, the end our own proxies append to. A client can prepend
 * anything it likes and never reach the entry we use.
 *
 * Zero hops returns `false`: trust nothing, and `request.ip` is the socket address.
 */
export function trustedProxy(hops: number): false | ((address: string, hop: number) => boolean) {
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
    throw new Error('trustProxyHops must be an integer from 0 to 5.')
  }
  if (hops === 0) return false

  return (address, hop) => {
    if (hop >= hops) return false
    if (hop > 0) return true
    const family = isIP(address)
    return family !== 0 && isPrivateAddress(address, family)
  }
}
