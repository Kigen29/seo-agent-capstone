import { describe, expect, it, vi } from 'vitest'
import { MapsUrlError, parseMapsUrl, resolveMapsUrl } from '../src/local/maps-url.js'

/** A fetch that answers with one redirect, then nothing. */
const redirectingFetch = (locations: (string | null)[]) => {
  let hop = 0
  return vi.fn(async () => {
    const location = locations[hop] ?? null
    hop += 1
    return {
      ok: false,
      status: location ? 302 : 200,
      headers: new Headers(location ? { location } : {}),
    } as Response
  })
}

describe('parseMapsUrl', () => {
  it('converts the hexadecimal feature id into the decimal CID', () => {
    // The identity that makes this exact rather than a guess: 0x8f1... in the feature id is the
    // same number Google puts in its own ?cid= links, in decimal.
    const profile = parseMapsUrl(
      'https://www.google.com/maps/place/Rangau+Tiles/@-1.39,36.74,17z/data=!3m1!4b1!4m6!3m5!1s0x182f05a3f0a1b2c3:0x4d2b1e7f9a0c3d5e!8m2!3d-1.39!4d36.74',
    )

    expect(profile?.cid).toBe(BigInt('0x4d2b1e7f9a0c3d5e').toString())
    expect(profile?.mapsUrl).toBe(`https://maps.google.com/?cid=${profile?.cid}`)
  })

  it('reads a CID given outright', () => {
    expect(parseMapsUrl('https://maps.google.com/?cid=5561234567890123456')?.cid).toBe(
      '5561234567890123456',
    )
  })

  it('reads the ludocid a knowledge panel link carries', () => {
    expect(parseMapsUrl('https://www.google.com/search?q=rangau&ludocid=123456789')?.cid).toBe(
      '123456789',
    )
  })

  it('reads a Place ID and builds the review link', () => {
    const profile = parseMapsUrl(
      'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
    )

    expect(profile?.placeId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
    expect(profile?.reviewUrl).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
    )
  })

  it('reads both identifiers when the link carries both', () => {
    const profile = parseMapsUrl(
      'https://www.google.com/maps/place/x/data=!4m2!3m1!1s0x1:0xabc!19sChIJN1t_tDeuEmsRUsoyG83frY4',
    )

    expect(profile?.cid).toBe('2748')
    expect(profile?.placeId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
  })

  it('accepts a country domain', () => {
    expect(parseMapsUrl('https://maps.google.co.ke/?cid=99')?.cid).toBe('99')
  })

  it('refuses a URL that is not Google at all', () => {
    // Null is the "wrong input" answer, kept distinct from a Google URL with no identifiers.
    expect(parseMapsUrl('https://maps.example.com/?cid=99')).toBeNull()
    expect(parseMapsUrl('https://google.com.evil.test/?cid=99')).toBeNull()
    expect(parseMapsUrl('not a url')).toBeNull()
  })

  it('returns an empty profile for a Google URL carrying no identifier', () => {
    expect(parseMapsUrl('https://www.google.com/maps')).toEqual({})
  })
})

describe('resolveMapsUrl', () => {
  it('follows a share link and reads the identifiers from where it lands', async () => {
    const fetch = redirectingFetch([
      'https://www.google.com/maps/place/Rangau/data=!4m2!3m1!1s0x1:0x4d2',
    ])

    const profile = await resolveMapsUrl('https://maps.app.goo.gl/abc123', fetch)

    expect(profile.cid).toBe('1234')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never touches the network for a full link that already carries a CID', async () => {
    const fetch = vi.fn()

    await resolveMapsUrl(
      'https://maps.google.com/?cid=42',
      fetch as unknown as typeof globalThis.fetch,
    )

    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses to follow a redirect that leaves Google', async () => {
    // The whole reason the hops are manual: this endpoint takes a URL from a user, and a
    // redirect off Google is where a share link would become a request forger's input.
    const fetch = redirectingFetch(['http://169.254.169.254/latest/meta-data/'])

    await expect(resolveMapsUrl('https://maps.app.goo.gl/abc123', fetch)).rejects.toBeInstanceOf(
      MapsUrlError,
    )
  })

  it('gives up rather than following a redirect chain forever', async () => {
    const fetch = redirectingFetch([
      'https://maps.google.com/a',
      'https://maps.google.com/b',
      'https://maps.google.com/c',
      'https://maps.google.com/d',
    ])

    await expect(resolveMapsUrl('https://maps.app.goo.gl/abc', fetch)).rejects.toBeInstanceOf(
      MapsUrlError,
    )
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('explains what to do when the link carries nothing', async () => {
    const fetch = redirectingFetch([null])

    await expect(resolveMapsUrl('https://maps.app.goo.gl/abc', fetch)).rejects.toThrow(
      /press Share/,
    )
  })

  it('says so plainly when the link is not a Google link', async () => {
    await expect(resolveMapsUrl('https://example.com/place', vi.fn())).rejects.toThrow(
      /not a Google Maps link/,
    )
  })
})
