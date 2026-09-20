/**
 * Read a business's Google identifiers out of a Maps link.
 *
 * A Google Business Profile has two public identifiers, and a local site needs both for different
 * jobs. The **CID** is the profile's numeric id, and `maps.google.com/?cid=<cid>` is the canonical
 * link to the profile, which is what `hasMap` and `sameAs` want in LocalBusiness markup. The
 * **Place ID** (`ChIJ...`) is the Places API's identifier, and it is what builds the "leave a
 * review" link a business actually wants on its contact page.
 *
 * Neither is discoverable from the site itself, and neither is something a client can be expected
 * to know. What they can do is open their profile in Maps and press Share, which produces a link
 * carrying one or both. This file turns that link into the identifiers, deterministically, with no
 * API key and no vendor.
 *
 * Two functions, because the two halves have different risks. {@link parseMapsUrl} is pure string
 * work over a URL and is the whole job for a full Maps link. {@link resolveMapsUrl} exists only
 * because the Share button usually hands over a `maps.app.goo.gl` short link, which carries nothing
 * until it is followed, and following a URL a user supplied is the part that needs a guard.
 *
 * The guard: only Google hosts, only redirects to Google hosts, at most three hops, and the
 * response body is never read. A user-supplied URL is otherwise a request forger's ideal input,
 * and an API that will fetch anything on request is an SSRF hole whatever the feature was for.
 */

/** What a Maps link told us. Every field is optional because links vary in what they carry. */
export interface BusinessProfile {
  /** The profile's numeric id, as a decimal string. It exceeds 2^53, so never a number. */
  cid?: string
  /** The Places identifier, e.g. `ChIJN1t_tDeuEmsRUsoyG83frY4`. */
  placeId?: string
  /** The canonical link to the profile, when a CID was found. */
  mapsUrl?: string
  /** A direct "write a review" link, when a Place ID was found. */
  reviewUrl?: string
}

/** Hosts whose links we will parse, and the only hosts a redirect may lead to. */
function isGoogleHost(host: string): boolean {
  const lower = host.toLowerCase()
  return (
    lower === 'g.page' ||
    lower === 'goo.gl' ||
    lower === 'maps.app.goo.gl' ||
    lower === 'google.com' ||
    // `google.co.ke`, `maps.google.de`, `www.google.com`: a Google domain in any country, and a
    // trailing-dot form, which is a legal hostname that would otherwise slip past a suffix test.
    /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?\.?$/.test(lower)
  )
}

/** Short links that carry nothing until they are followed. */
function isShortLink(url: URL): boolean {
  const host = url.host.toLowerCase()
  return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.page'
}

/**
 * The CID, hidden in the feature id.
 *
 * Maps encodes a place as `0x<cell>:0x<cid>` in the `data` path segment (as `!1s0x…:0x…`) and in
 * the `ftid` parameter. The second half is the CID in hexadecimal, and Google's own `?cid=` links
 * are the same number in decimal, so the conversion is exact rather than a guess. It is well over
 * 2^53, which is why it is carried as a string and converted with BigInt.
 */
const FEATURE_ID = /0x[0-9a-f]+:0x([0-9a-f]+)/i

/**
 * A Places identifier, wherever it appears in the link.
 *
 * No word boundary in front of it, because Maps embeds the id directly after a segment marker
 * (`!19sChIJ…`) and `s` to `C` is not a boundary. Restricted to the `ChIJ` prefix every business
 * profile uses: the encoded forms that start with other letters are indistinguishable from any
 * other opaque token in a URL, and matching those would invent a Place ID out of a tracking
 * parameter.
 */
const PLACE_ID = /(ChIJ[A-Za-z0-9_-]{10,})/

/** The canonical profile link for a CID. */
export const mapsUrlForCid = (cid: string): string => `https://maps.google.com/?cid=${cid}`

/** The review link for a Place ID. */
export const reviewUrlForPlaceId = (placeId: string): string =>
  `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`

/**
 * Pull the identifiers out of a Google Maps URL.
 *
 * Returns null for anything that is not a Google URL at all, which is a different answer from a
 * Google URL that carried no identifiers: the first is the wrong input, the second is a link that
 * needs following or a link to something that is not a business.
 */
export function parseMapsUrl(input: string): BusinessProfile | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!isGoogleHost(url.host)) return null

  const profile: BusinessProfile = {}
  const whole = decodeURIComponent(url.href)

  // A CID given outright. `cid` is Google's own link format; `ludocid` appears on links copied
  // out of a knowledge panel.
  const explicit = url.searchParams.get('cid') ?? url.searchParams.get('ludocid')
  if (explicit && /^\d+$/.test(explicit)) {
    profile.cid = explicit
  } else {
    const [, hex] = FEATURE_ID.exec(whole) ?? []
    if (hex) profile.cid = BigInt(`0x${hex}`).toString()
  }

  const placeId =
    url.searchParams.get('place_id') ?? url.searchParams.get('placeid') ?? PLACE_ID.exec(whole)?.[1]
  if (placeId) profile.placeId = placeId

  if (profile.cid) profile.mapsUrl = mapsUrlForCid(profile.cid)
  if (profile.placeId) profile.reviewUrl = reviewUrlForPlaceId(profile.placeId)

  return profile
}

/** A supplied link could not be read, with a reason meant for the person who pasted it. */
export class MapsUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapsUrlError'
  }
}

/** At most this many redirects. Short links use one; more than this is a loop or a trick. */
const MAX_HOPS = 3

/**
 * Follow a Maps share link far enough to read its identifiers.
 *
 * Redirects are followed by hand rather than by the fetch implementation, because the check that
 * matters happens between hops: every destination is re-tested against the Google allow-list, so a
 * Google short link that redirects to an internal address is refused at the hop rather than
 * fetched. `redirect: 'manual'` also means the body is never downloaded; only the `location`
 * header is read.
 */
export async function resolveMapsUrl(
  input: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<BusinessProfile> {
  const direct = parseMapsUrl(input)
  if (direct === null) {
    throw new MapsUrlError(
      'That is not a Google Maps link. Open your business in Google Maps, press Share, and copy ' +
        'the link it offers.',
    )
  }

  let current: URL
  try {
    current = new URL(input.trim())
  } catch {
    throw new MapsUrlError('That is not a valid URL.')
  }

  // A full Maps URL that already carries what we need never touches the network.
  if (!isShortLink(current) && (direct.cid || direct.placeId)) return direct

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let response: Response
    try {
      response = await doFetch(current.href, { method: 'GET', redirect: 'manual' })
    } catch {
      throw new MapsUrlError('Could not reach Google to follow that link. Try again shortly.')
    }

    const location = response.headers.get('location')
    if (!location) break

    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      break
    }

    // The reason the hops are manual. A redirect off Google is where a share link stops being a
    // share link, and following it would make this endpoint fetch whatever a caller wanted.
    if (!isGoogleHost(next.host)) {
      throw new MapsUrlError('That link redirects off Google, so it was not followed.')
    }

    const resolved = parseMapsUrl(next.href)
    if (resolved && (resolved.cid || resolved.placeId)) return resolved

    current = next
  }

  throw new MapsUrlError(
    'That link carries no business identifier. A search results link often does not; open the ' +
      'business itself in Google Maps, press Share, and copy that link.',
  )
}
