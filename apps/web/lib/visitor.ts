import { signVisitorAddress } from '@seo/core'
import { headers } from 'next/headers'

/**
 * The headers that tell the API which visitor a call is being made for.
 *
 * Every API call goes out from this server, so the API would otherwise count all anonymous
 * visitors as one. The visitor's address is signed with a secret the API also holds, and the
 * API believes it only when the signature checks out.
 *
 * The address is taken from the two headers the host sets itself and overwrites on the way in,
 * so a visitor cannot write their own: `x-vercel-forwarded-for` and `x-real-ip`. The ordinary
 * `x-forwarded-for` is deliberately not read. Anybody can send that one, and signing an address
 * a visitor chose would hand them exactly the escape this exists to close.
 *
 * Returns nothing when the secret is not set or the address is not known, and the call then goes
 * out as it always did.
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  const secret = process.env.VISITOR_ADDRESS_SECRET
  if (!secret) return {}

  const incoming = await headers()
  const address =
    incoming.get('x-vercel-forwarded-for')?.split(',')[0] ?? incoming.get('x-real-ip') ?? ''

  return signVisitorAddress(secret, address)
}
