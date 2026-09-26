import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { lookup } from 'node:dns/promises'
import { isPrivateAddress } from '@seo/core'

/**
 * Fetch a URL a stranger supplied, without becoming their proxy.
 *
 * This is the guard ADR-0025 requires before any anonymous route may exist. The failure it exists
 * to prevent is server-side request forgery: a public endpoint that fetches whatever it is given
 * is an internal port scanner with a friendly front end, and on a cloud host the first thing it
 * scans is the metadata service.
 *
 * The defence is layered because each layer has a known hole:
 *
 *   1. **Scheme and shape.** `https` only, no credentials in the URL, no ports other than 443.
 *   2. **DNS resolution before the request.** Checking the hostname is not enough: a name can
 *      resolve to `127.0.0.1`, and an attacker controls their own DNS. So every address the name
 *      resolves to is checked against the private ranges, and a name that resolves to any private
 *      address is refused outright rather than filtered down to its public addresses.
 *   3. **Manual redirects.** Each hop is re-checked from the top, because a public URL that
 *      redirects to `169.254.169.254` defeats a check performed only on the first URL.
 *   4. **Caps.** A byte ceiling and a timeout, so a slow or enormous response cannot hold the
 *      request open or exhaust memory on a free-tier instance.
 *
 * The transport connects to an address from the validated DNS answer while retaining the
 * original Host header and TLS server name. DNS cannot change the destination after validation.
 */

/** Refused before anything was fetched, with a reason meant for the person who pasted the URL. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

/** Resolve a hostname and refuse it if *any* address it answers with is private. */
async function assertPublicHost(
  hostname: string,
  resolve: typeof lookup = lookup,
): Promise<{ address: string; family: number }[]> {
  let addresses: { address: string; family: number }[]
  try {
    addresses = await resolve(hostname, { all: true })
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${hostname}.`)
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve ${hostname}.`)
  }

  // Any, not all. A name resolving to one public and one private address is a name we refuse:
  // which one a later connection picks is not ours to control.
  if (addresses.some((entry) => isPrivateAddress(entry.address, entry.family))) {
    throw new UnsafeUrlError(
      `${hostname} resolves to a private address, so it was not fetched. This endpoint only ` +
        'reaches sites on the public internet.',
    )
  }
  return addresses
}

export interface PublicFetchOptions {
  /** How many redirects to follow. Each one is re-checked from the top. */
  maxRedirects?: number
  /** Give up after this many milliseconds, including redirects. */
  timeoutMs?: number
  /** Stop reading after this many bytes. A page larger than this is not a page we need. */
  maxBytes?: number
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch
  /** Injected for tests, so DNS behaviour can be driven without a network. */
  resolve?: typeof lookup
}

export interface PublicFetchResult {
  /** Where we ended up after redirects. */
  finalUrl: string
  status: number
  headers: Record<string, string>
  /** The response body, truncated at the byte ceiling. */
  body: string
  /** Every URL in the chain, in order, including the first. */
  chain: string[]
}

const DEFAULTS = { maxRedirects: 3, timeoutMs: 10_000, maxBytes: 2_000_000 }

/** Parse and check a URL without fetching it. Exported so a caller can validate before queueing. */
export async function assertFetchable(input: string, resolve?: typeof lookup): Promise<URL> {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new UnsafeUrlError('That is not a URL. Include the https:// prefix.')
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only https addresses are checked.')
  }

  // Credentials in a URL are a redirect trick and a credential leak into our logs, never a thing
  // a site being audited needs.
  if (url.username || url.password) {
    throw new UnsafeUrlError('A URL with a username or password in it is not fetched.')
  }

  if (url.port && url.port !== '443') {
    throw new UnsafeUrlError('Only the standard https port is checked.')
  }

  await assertPublicHost(url.hostname, resolve)
  return url
}

/**
 * Fetch one public URL, following redirects by hand and checking every hop.
 *
 * Returns the body as text. A non-HTML response is returned as it came: the caller decides what to
 * do with it, because robots.txt and a sitemap are both fetched through here and neither is HTML.
 */
export async function publicFetch(
  input: string,
  options: PublicFetchOptions = {},
): Promise<PublicFetchResult> {
  const { maxRedirects, timeoutMs, maxBytes } = { ...DEFAULTS, ...options }
  const doFetch =
    options.fetch ??
    (async (input: string | URL | Request, init?: RequestInit) => {
      const target = new URL(String(input))
      const addresses = await assertPublicHost(target.hostname, options.resolve)
      const address = addresses[0]!
      return new Promise<Response>((resolve, reject) => {
        const request = httpsRequest(
          target,
          {
            hostname: address.address,
            family: address.family,
            servername: target.hostname,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers).entries()),
              host: target.host,
            },
            ...(init?.signal ? { signal: init.signal } : {}),
          },
          (response) => {
            const headers = new Headers()
            for (const [key, value] of Object.entries(response.headers)) {
              if (value !== undefined)
                headers.set(key, Array.isArray(value) ? value.join(', ') : value)
            }
            const status = response.statusCode ?? 502
            const body = [204, 205, 304].includes(status)
              ? null
              : (Readable.toWeb(response) as unknown as ConstructorParameters<typeof Response>[0])
            if (body === null) response.resume()
            resolve(new Response(body, { status, headers }))
          },
        )
        request.on('error', reject)
        request.end()
      })
    })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let url = await assertFetchable(input, options.resolve)
    const chain: string[] = [url.href]

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await doFetch(url.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Named, so an operator reading their logs can tell what this was and block it if they
          // want to. A public fetcher that disguises itself is a different kind of tool.
          'user-agent': 'RankwrightCheck/1.0 (+https://github.com/Kigen29/seo-agent-capstone)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
      })

      const location = response.headers.get('location')
      const redirected = response.status >= 300 && response.status < 400 && location

      if (!redirected) {
        return {
          finalUrl: url.href,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await readCapped(response, maxBytes),
          chain,
        }
      }

      await response.body?.cancel()
      if (hop === maxRedirects) {
        throw new UnsafeUrlError(`That URL redirects more than ${maxRedirects} times.`)
      }

      // The whole reason redirects are manual: the next hop is checked exactly as the first was,
      // so a public URL cannot bounce us onto a private address.
      url = await assertFetchable(new URL(location, url).href, options.resolve)
      chain.push(url.href)
    }

    throw new UnsafeUrlError('That URL redirected too many times.')
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UnsafeUrlError(`That site did not respond within ${timeoutMs / 1000} seconds.`)
    }
    throw new UnsafeUrlError('That site could not be reached.')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read a response body, stopping at the ceiling.
 *
 * Streamed rather than `response.text()`, because the point is to never hold a hostile response in
 * memory: a 4GB body would be read in full before any length check on the resulting string.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let read = 0
  let text = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    read += value.byteLength
    if (read > maxBytes) {
      text += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (read - maxBytes))))
      await reader.cancel()
      break
    }

    text += decoder.decode(value, { stream: true })
  }

  return text
}
