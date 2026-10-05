import type { BrowserContext } from 'playwright'
import type { BlockedRequest, EgressGuard } from './egress.js'
import type { CrawledPage } from './types.js'

/**
 * Do the links that leave the site still go anywhere?
 *
 * The crawl stays on the site's own host on purpose, so a link to a page that was deleted years
 * ago went unnoticed. This checks them afterwards, and it is deliberately conservative about what
 * it calls broken, because "we could not load it" and "it is gone" are different facts:
 *
 *   broken        the server answered 404 or 410, or the domain no longer resolves
 *   ok            anything that answered and was not one of those
 *   inconclusive  the server refused us (401, 403, 429), failed (5xx), or did not answer in time
 *
 * A great many sites answer a crawler with 403 or 429 while serving a browser happily. Reporting
 * those as broken would send a person to "fix" links that work, which is how an audit tool gets
 * ignored. Only the first group ever becomes a finding.
 *
 * Every request goes through the same egress guard as the crawl, hop by hop, so a page cannot
 * use an outbound link to make us reach a private address. The number checked is capped: these
 * are requests to origins that did not ask to be audited.
 */
export type OutboundOutcome = 'ok' | 'broken' | 'inconclusive'

export interface OutboundLink {
  url: string
  outcome: OutboundOutcome
  /** The final HTTP status, or null when there was no response at all. */
  status: number | null
  /** Why, in words, when there was no usable status: a dead domain, a timeout, a refusal. */
  reason?: string
  /** The crawled pages that carry the link. */
  linkedFrom: string[]
}

export interface OutboundOptions {
  /** How many distinct URLs to check. 0 disables the check. */
  limit: number
  timeoutMs?: number
  concurrency?: number
  onBlocked?: (blocked: BlockedRequest) => void
}

export const DEFAULT_OUTBOUND_LIMIT = 100

const MAX_REDIRECTS = 5

const siteOf = (host: string): string => host.toLowerCase().replace(/^www\./, '')

/**
 * The distinct external links on the crawled pages, most-linked first.
 *
 * "External" is judged against every host the crawl actually landed on, with `www.` ignored: a
 * site served on `www.example.com` that links `example.com/about` is linking to itself.
 */
export function outboundCandidates(
  pages: readonly CrawledPage[],
  limit: number,
): { url: string; linkedFrom: string[] }[] {
  const own = new Set<string>()
  for (const page of pages) {
    for (const address of [page.url, page.finalUrl]) {
      try {
        own.add(siteOf(new URL(address).host))
      } catch {
        // An unparseable crawled URL has no host to exclude.
      }
    }
  }

  const byUrl = new Map<string, Set<string>>()
  for (const page of pages) {
    if (page.status !== 200) continue
    for (const link of page.extract.links) {
      if (!link.resolved) continue
      let target: URL
      try {
        target = new URL(link.resolved)
      } catch {
        continue
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') continue
      if (own.has(siteOf(target.host))) continue
      target.hash = ''
      const key = target.toString()
      byUrl.set(key, (byUrl.get(key) ?? new Set()).add(page.finalUrl))
    }
  }

  return (
    [...byUrl.entries()]
      .map(([url, from]) => ({ url, linkedFrom: [...from].sort() }))
      // Most-linked first, then by URL, so a capped check is the same set on every crawl.
      .sort((a, b) => b.linkedFrom.length - a.linkedFrom.length || (a.url < b.url ? -1 : 1))
      .slice(0, Math.max(0, limit))
  )
}

const classify = (status: number): OutboundOutcome =>
  status === 404 || status === 410
    ? 'broken'
    : status === 401 || status === 403 || status === 429 || status >= 500
      ? 'inconclusive'
      : 'ok'

/**
 * One request, following redirects ourselves so every hop passes the guard. Shared with the image
 * check: anything that asks a host the site merely mentions goes through here.
 */
export async function guardedRequest(
  context: BrowserContext,
  guard: EgressGuard,
  method: 'HEAD' | 'GET',
  input: string,
  timeout: number,
  onBlocked?: (blocked: BlockedRequest) => void,
): Promise<{
  status: number | null
  reason?: string
  dead?: boolean
  headers?: Record<string, string>
}> {
  let url = input
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const refusal = await guard(url)
    if (refusal) {
      // A domain that no longer resolves is the one refusal that is evidence about the link.
      if (/could not be resolved/.test(refusal))
        return { status: null, reason: refusal, dead: true }
      onBlocked?.({ url, reason: refusal })
      return { status: null, reason: refusal }
    }
    const response = await context.request.fetch(url, { method, timeout, maxRedirects: 0 })
    const status = response.status()
    const headers = response.headers()
    const location = headers['location']
    await response.dispose()
    if (status < 300 || status >= 400 || !location) return { status, headers }
    url = new URL(location, url).toString()
  }
  return { status: null, reason: 'Too many redirects.' }
}

async function checkOne(
  context: BrowserContext,
  guard: EgressGuard,
  candidate: { url: string; linkedFrom: string[] },
  timeout: number,
  onBlocked?: (blocked: BlockedRequest) => void,
): Promise<OutboundLink> {
  const done = (
    outcome: OutboundOutcome,
    status: number | null,
    reason?: string,
  ): OutboundLink => ({ ...candidate, outcome, status, ...(reason ? { reason } : {}) })

  try {
    let result = await guardedRequest(context, guard, 'HEAD', candidate.url, timeout, onBlocked)
    if (result.dead) return done('broken', null, result.reason)
    // Plenty of servers answer HEAD wrongly (404, 405, 403) for a page GET serves. Never call a
    // link broken, or blocked, on the strength of HEAD alone.
    if (result.status === null || result.status >= 400) {
      result = await guardedRequest(context, guard, 'GET', candidate.url, timeout, onBlocked)
      if (result.dead) return done('broken', null, result.reason)
    }
    if (result.status === null) return done('inconclusive', null, result.reason)
    return done(classify(result.status), result.status)
  } catch (error) {
    // A timeout or a reset connection says nothing about whether the page exists.
    return done(
      'inconclusive',
      null,
      error instanceof Error ? error.message.split('\n')[0] : 'failed',
    )
  }
}

export async function checkOutboundLinks(
  context: BrowserContext,
  guard: EgressGuard,
  pages: readonly CrawledPage[],
  options: OutboundOptions,
): Promise<OutboundLink[]> {
  const candidates = outboundCandidates(pages, options.limit)
  const timeout = options.timeoutMs ?? 10_000
  const results: OutboundLink[] = new Array<OutboundLink>(candidates.length)

  // One request at a time per host: a page linking one site fifty times must not hit it in a burst.
  const hostQueues = new Map<string, Promise<void>>()
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      const candidate = candidates[index]
      if (!candidate) return
      const host = new URL(candidate.url).host
      const turn = (hostQueues.get(host) ?? Promise.resolve()).then(async () => {
        results[index] = await checkOne(context, guard, candidate, timeout, options.onBlocked)
      })
      hostQueues.set(host, turn)
      await turn
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, () => worker()))
  return results
}
