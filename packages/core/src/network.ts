/**
 * The networks a public site is never on.
 *
 * Shared by every path that fetches a URL a customer or a crawled page chose: the SSRF-guarded
 * HTTP client in @seo/connectors and the crawler's browser egress guard. One definition, so the
 * two cannot drift and leave one door open that the other closed. Pure string logic, no DNS: the
 * caller resolves, this only classifies an address it was handed.
 *
 * Unparseable input counts as private. A check that fails open is not a check.
 */
export function isPrivateAddress(address: string, family: number): boolean {
  if (family === 6) {
    const lower = address.toLowerCase()
    return (
      !/^[23][0-9a-f]{3}:/.test(lower) ||
      lower.startsWith('2001:db8:') ||
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') || // unique local
      lower.startsWith('fd') ||
      lower.startsWith('fe80') || // link local
      // An IPv4 address wearing an IPv6 coat, which is how a private range sneaks past a v6 check.
      lower.startsWith('::ffff:')
    )
  }

  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true

  const [a = 0, b = 0, c = 0] = parts
  return (
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link local, and the cloud metadata service
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  )
}
