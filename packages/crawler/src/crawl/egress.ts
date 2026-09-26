import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPrivateAddress } from '@seo/core'
import type { APIResponse, BrowserContext } from 'playwright'

/**
 * Keep the crawler's browser on the public internet.
 *
 * The crawler loads pages a stranger wrote, in a real browser, from inside our infrastructure.
 * Every `<img>`, `<iframe>`, `fetch()`, redirect and WebSocket on those pages is a request our
 * worker makes on the page author's behalf. Without a guard, a crawled page can point the browser
 * at the cloud metadata service or a private admin panel and read the answer back into its own
 * rendered DOM, which we then store. The HTTP client in @seo/connectors already refuses private
 * destinations; this closes the same door for the browser and for Playwright's request context.
 *
 * Layers, and what each one misses:
 *
 *   1. **Every browser request is routed.** Subresources, navigations and scripted fetches pass
 *      through `context.route`, and any whose host resolves to a private address is aborted
 *      before a connection is made. Playwright does not route redirect hops, so the handler
 *      fetches each request itself without following redirects and vets the Location first.
 *   2. **WebSockets are routed too**, because `context.route` does not see them.
 *   3. **Service workers are blocked** at context creation, because their requests bypass routing.
 *   4. **Root-file fetches follow redirects by hand**, re-checking every hop, because Playwright's
 *      request context is not routed.
 *
 * What this cannot do: Chromium resolves the name again when it connects, so a hostile DNS server
 * can answer publicly to our check and privately to Chromium (rebinding). Caching the verdict per
 * host narrows that window but does not close it. The complete defence is network-level egress
 * filtering on the worker host; this guard is the layer we can ship and test in code.
 */

export type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>

export interface EgressPolicy {
  /**
   * Allow private and loopback destinations. Only for tests and local fixtures that serve pages
   * from 127.0.0.1; production audits never set it.
   */
  allowPrivateNetwork?: boolean
  /** Injected for tests, so DNS answers can be driven without a network. */
  resolve?: Resolve
  /** Injected for tests. Which resolved addresses to refuse; defaults to every private range. */
  isBlocked?: (address: string, family: number) => boolean
}

/** Returns why a URL may not be fetched, or null when it may. */
export type EgressGuard = (url: string) => Promise<string | null>

const defaultResolve: Resolve = (hostname) => lookup(hostname, { all: true })

export function createEgressGuard(policy: EgressPolicy = {}): EgressGuard {
  if (policy.allowPrivateNetwork) return async () => null

  const resolve = policy.resolve ?? defaultResolve
  const isBlocked = policy.isBlocked ?? isPrivateAddress
  // One verdict per host for the life of the crawl: consistent, and one lookup per host.
  const verdicts = new Map<string, Promise<string | null>>()

  const judgeHost = async (hostname: string): Promise<string | null> => {
    const literal = hostname.replace(/^\[|\]$/g, '')
    const family = isIP(literal)
    if (family !== 0) {
      return isBlocked(literal, family) ? `${hostname} is a private address.` : null
    }
    let addresses: { address: string; family: number }[]
    try {
      addresses = await resolve(literal)
    } catch {
      return `${hostname} could not be resolved.`
    }
    if (addresses.length === 0) return `${hostname} could not be resolved.`
    // Any, not all: which address a later connection picks is not ours to control.
    return addresses.some((entry) => isBlocked(entry.address, entry.family))
      ? `${hostname} resolves to a private address.`
      : null
  }

  return async (input) => {
    let url: URL
    try {
      url = new URL(input)
    } catch {
      return 'Not a valid URL.'
    }
    // data: and blob: never reach the network, and Chromium does not route them.
    if (url.protocol === 'data:' || url.protocol === 'blob:') return null
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      return `The ${url.protocol} scheme is not fetched.`
    }
    const host = url.hostname.toLowerCase()
    let verdict = verdicts.get(host)
    if (!verdict) {
      verdict = judgeHost(host)
      verdicts.set(host, verdict)
    }
    return verdict
  }
}

export interface BlockedRequest {
  url: string
  reason: string
}

/** Route every browser request and WebSocket in the context through the guard. */
export async function installEgressGuard(
  context: BrowserContext,
  guard: EgressGuard,
  onBlocked?: (blocked: BlockedRequest) => void,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    const reason = await guard(url)
    if (reason) {
      onBlocked?.({ url, reason })
      return route.abort('blockedbyclient').catch(() => undefined)
    }

    // Playwright only routes the first URL of a redirect chain; Chromium follows later hops
    // without asking. So the browser is never allowed to follow one on its own: fetch this hop
    // without following, vet the Location, and hand the response back. When Chromium follows a
    // fulfilled redirect, that next hop is a fresh request and comes through here again.
    let response: APIResponse
    try {
      response = await route.fetch({ maxRedirects: 0 })
    } catch {
      return route.abort('failed').catch(() => undefined)
    }
    const location = response.headers()['location']
    if (response.status() >= 300 && response.status() < 400 && location) {
      const next = new URL(location, url).toString()
      const refused = await guard(next)
      if (refused) {
        onBlocked?.({ url: next, reason: refused })
        return route.abort('blockedbyclient').catch(() => undefined)
      }
    }
    return route.fulfill({ response }).catch(() => undefined)
  })

  await context.routeWebSocket(/.*/, async (socket) => {
    const reason = await guard(socket.url())
    if (!reason) return socket.connectToServer()
    onBlocked?.({ url: socket.url(), reason })
    await socket.close({ code: 1008, reason: 'Blocked by crawler egress policy.' })
  })
}

const MAX_ROOT_FILE_REDIRECTS = 5

/**
 * GET through Playwright's request context, following redirects by hand so every hop is checked.
 * Returns null when a hop is refused or the chain is too long; the callers already treat a missing
 * root file as "not there", which is the honest reading of a file we refused to fetch.
 */
export async function guardedGet(
  context: BrowserContext,
  guard: EgressGuard,
  input: string,
  timeout: number,
  onBlocked?: (blocked: BlockedRequest) => void,
): Promise<APIResponse | null> {
  let url = input
  for (let hop = 0; hop <= MAX_ROOT_FILE_REDIRECTS; hop += 1) {
    const reason = await guard(url)
    if (reason) {
      onBlocked?.({ url, reason })
      return null
    }
    const response = await context.request.get(url, { timeout, maxRedirects: 0 })
    const location = response.headers()['location']
    if (response.status() < 300 || response.status() >= 400 || !location) return response
    await response.dispose()
    url = new URL(location, url).toString()
  }
  return null
}
