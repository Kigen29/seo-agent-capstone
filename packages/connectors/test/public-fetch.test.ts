import { describe, expect, it, vi } from 'vitest'
import { assertFetchable, publicFetch, UnsafeUrlError } from '../src/http/public-fetch.js'

/**
 * The guard ADR-0025 requires before an anonymous route may exist.
 *
 * Every test here is a way somebody turns a public fetcher into a proxy for our internal network.
 * They are written as the attacks they are, because a reader who skims this file should come away
 * knowing what it is defending against.
 */

/** A DNS stub. Real resolution would make these tests depend on somebody else's zone file. */
const resolves = (map: Record<string, { address: string; family: number }[]>) =>
  (async (hostname: string) => {
    const answer = map[hostname]
    if (!answer) throw new Error('NXDOMAIN')
    return answer
  }) as never

const PUBLIC = { 'example.com': [{ address: '93.184.216.34', family: 4 }] }

const ok = (body: string, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(body, { status: 200, headers })) as unknown as typeof fetch

describe('assertFetchable', () => {
  it('accepts an ordinary https URL on a public address', async () => {
    const url = await assertFetchable('https://example.com/page', resolves(PUBLIC))

    expect(url.hostname).toBe('example.com')
  })

  it('refuses a hostname that resolves to loopback', async () => {
    // The attack a hostname check alone misses: the name is public, the address is not, and the
    // attacker owns the zone.
    await expect(
      assertFetchable(
        'https://evil.test/',
        resolves({ 'evil.test': [{ address: '127.0.0.1', family: 4 }] }),
      ),
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('refuses the cloud metadata address', async () => {
    await expect(
      assertFetchable(
        'https://metadata.test/',
        resolves({ 'metadata.test': [{ address: '169.254.169.254', family: 4 }] }),
      ),
    ).rejects.toThrow(/private address/)
  })

  it.each([
    ['10.0.0.5', 4],
    ['172.16.0.1', 4],
    ['192.168.1.1', 4],
    ['100.64.0.1', 4],
    ['0.0.0.0', 4],
    ['::1', 6],
    ['fd00::1', 6],
    ['fe80::1', 6],
    ['::ffff:127.0.0.1', 6],
  ])('refuses %s', async (address, family) => {
    await expect(
      assertFetchable('https://host.test/', resolves({ 'host.test': [{ address, family }] })),
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('refuses a name that answers with one public and one private address', async () => {
    // Which address a later connection picks is not ours to control, so any private answer is a
    // refusal rather than a filter.
    await expect(
      assertFetchable(
        'https://split.test/',
        resolves({
          'split.test': [
            { address: '93.184.216.34', family: 4 },
            { address: '10.1.2.3', family: 4 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('refuses anything that is not https, including a file or a gopher URL', async () => {
    for (const url of ['http://example.com/', 'file:///etc/passwd', 'gopher://example.com/']) {
      await expect(assertFetchable(url, resolves(PUBLIC))).rejects.toBeInstanceOf(UnsafeUrlError)
    }
  })

  it('refuses credentials in the URL', async () => {
    // A redirect trick, and a credential leaked into our logs.
    await expect(
      assertFetchable('https://user:pass@example.com/', resolves(PUBLIC)),
    ).rejects.toThrow(/username or password/)
  })

  it('refuses a non-standard port, which is how an internal service is reached', async () => {
    await expect(assertFetchable('https://example.com:8080/', resolves(PUBLIC))).rejects.toThrow(
      /standard https port/,
    )
  })

  it('refuses something that is not a URL at all', async () => {
    await expect(assertFetchable('example.com', resolves(PUBLIC))).rejects.toThrow(/not a URL/)
  })
})

describe('publicFetch', () => {
  it('returns the body, the status and where it ended up', async () => {
    const result = await publicFetch('https://example.com/', {
      fetch: ok('<html>hi</html>', { 'content-type': 'text/html' }),
      resolve: resolves(PUBLIC),
    })

    expect(result).toMatchObject({
      finalUrl: 'https://example.com/',
      status: 200,
      body: '<html>hi</html>',
      chain: ['https://example.com/'],
    })
  })

  it('re-checks every redirect hop, so a public URL cannot bounce onto a private one', async () => {
    // The attack that beats a check performed only on the first URL.
    const fetchImpl = vi.fn(
      async () =>
        new Response('', { status: 302, headers: { location: 'https://internal.test/' } }),
    ) as unknown as typeof fetch

    await expect(
      publicFetch('https://example.com/', {
        fetch: fetchImpl,
        resolve: resolves({
          ...PUBLIC,
          'internal.test': [{ address: '169.254.169.254', family: 4 }],
        }),
      }),
    ).rejects.toThrow(/private address/)
  })

  it('follows a redirect that stays public, and records the chain', async () => {
    let hop = 0
    const fetchImpl = vi.fn(async () => {
      hop += 1
      return hop === 1
        ? new Response('', { status: 301, headers: { location: 'https://example.com/final' } })
        : new Response('done', { status: 200 })
    }) as unknown as typeof fetch

    const result = await publicFetch('https://example.com/', {
      fetch: fetchImpl,
      resolve: resolves(PUBLIC),
    })

    expect(result.body).toBe('done')
    expect(result.chain).toEqual(['https://example.com/', 'https://example.com/final'])
  })

  it('gives up on a redirect loop rather than following it forever', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('', { status: 302, headers: { location: 'https://example.com/loop' } }),
    ) as unknown as typeof fetch

    await expect(
      publicFetch('https://example.com/', {
        fetch: fetchImpl,
        resolve: resolves(PUBLIC),
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/redirects more than/)
  })

  it('stops reading at the byte ceiling rather than holding a hostile body in memory', async () => {
    const result = await publicFetch('https://example.com/', {
      fetch: ok('x'.repeat(5000)),
      resolve: resolves(PUBLIC),
      maxBytes: 1000,
    })

    expect(result.body.length).toBeLessThanOrEqual(1000)
  })

  it('reports a refusal as its own error, not as a generic failure', async () => {
    // The caller turns this into a 400 with the message, so it has to survive the catch-all.
    await expect(
      publicFetch('http://example.com/', { fetch: ok(''), resolve: resolves(PUBLIC) }),
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})
