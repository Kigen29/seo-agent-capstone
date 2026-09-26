/**
 * The URL frontier: what to crawl next, what we have already done, and enough state to
 * survive being killed halfway through.
 *
 * Kept separate from the browser on purpose. Resumability is a correctness property and
 * it deserves its own tests, not tests that need Chromium to run.
 */

/** Tracking parameters generate an unbounded number of URLs for one page. */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|msclkid$|mc_cid$|mc_eid$|_ga$|ref$)/i

/**
 * Reduce a URL to a canonical form for deduplication.
 *
 * The fragment is never sent to the server, so /a and /a#top are one page. Tracking
 * parameters are noise: without stripping them a single shared link can spawn hundreds
 * of "distinct" URLs and eat the entire crawl budget on one page.
 */
export function normaliseUrl(input: string, base?: string): string | undefined {
  let url: URL
  try {
    url = new URL(input, base)
  } catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined

  url.hash = ''
  url.hostname = url.hostname.toLowerCase()

  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = ''
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
  }

  return url.toString()
}

export interface FrontierEntry {
  url: string
  /** Hops from the seed. Click depth greater than 3 is itself a finding (TECH-014). */
  depth: number
}

export interface FrontierState {
  queue: FrontierEntry[]
  inFlight?: FrontierEntry[]
  visited: string[]
  seen: string[]
}

export interface FrontierOptions {
  maxPages?: number
  /** Stay on the seed's host. Following every outbound link would crawl the web. */
  sameHostOnly?: boolean
}

/**
 * The part of a host that decides "same site": lowercased, with one leading `www.` removed.
 *
 * `example.com` and `www.example.com` are one site to every person and every search engine, and
 * sites routinely redirect one to the other. Treating them as different hosts meant a seed typed
 * without `www.` redirected to it, every link on the page resolved to `www.`, and the crawl threw
 * them all away and stopped after one page. Other subdomains stay separate sites.
 */
export function siteKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

export class Frontier {
  private readonly queue: FrontierEntry[] = []
  private readonly inFlight = new Map<string, FrontierEntry>()
  private readonly visited = new Set<string>()
  /** Every URL ever enqueued, so a page linked from fifty places is queued once. */
  private readonly seen = new Set<string>()

  private readonly maxPages: number
  private readonly sameHostOnly: boolean
  /** Site keys (see siteKey) the crawl may enter: the seed's, plus any host the seed redirected to. */
  private readonly sites = new Set<string>()

  constructor(seed: string, options: FrontierOptions = {}) {
    this.maxPages = options.maxPages ?? 500
    this.sameHostOnly = options.sameHostOnly ?? true

    const normalised = normaliseUrl(seed)
    if (!normalised) throw new Error(`The seed URL is not a valid http(s) URL: ${seed}`)

    this.sites.add(siteKey(new URL(normalised).host))
    this.add([normalised], 0)
  }

  /**
   * Also accept a host the seed redirected to, so `example.com` redirecting to `example.co.uk`
   * crawls the site the owner actually serves. Only the crawler calls this, and only with the
   * seed's own final URL; links on pages never widen the crawl.
   */
  allowHost(host: string): void {
    this.sites.add(siteKey(host))
  }

  /** Enqueue URLs discovered on a page. Returns how many were actually new. */
  add(urls: readonly string[], depth: number): number {
    let added = 0

    for (const raw of urls) {
      const url = normaliseUrl(raw)
      if (!url) continue
      if (this.seen.has(url)) continue
      if (this.sameHostOnly && !this.sites.has(siteKey(new URL(url).host))) continue

      this.seen.add(url)
      this.queue.push({ url, depth })
      added += 1
    }

    return added
  }

  /**
   * The next URL to crawl, or undefined when we are done. Breadth-first, so a 500-page
   * budget spends itself on the shallow pages that matter rather than descending one
   * branch of a paginated archive forever.
   */
  next(): FrontierEntry | undefined {
    if (this.visited.size + this.inFlight.size >= this.maxPages) return undefined
    const entry = this.queue.shift()
    if (entry) this.inFlight.set(entry.url, entry)
    return entry
  }

  /** Call once a page is fully processed AND persisted, never before. */
  complete(url: string): void {
    this.inFlight.delete(url)
    this.visited.add(url)
  }

  get visitedCount(): number {
    return this.visited.size
  }

  get pendingCount(): number {
    return this.queue.length
  }

  get budgetExhausted(): boolean {
    return this.visited.size >= this.maxPages
  }

  /**
   * Snapshot for persistence. Written after every completed page, so a crawl killed at
   * page 47 resumes at 48 rather than starting again and re-hammering the site.
   */
  toState(): FrontierState {
    return {
      queue: [...this.queue],
      inFlight: [...this.inFlight.values()],
      visited: [...this.visited],
      seen: [...this.seen],
    }
  }

  static fromState(seed: string, state: FrontierState, options: FrontierOptions = {}): Frontier {
    const frontier = new Frontier(seed, options)

    // The constructor seeded the queue. Replace it wholesale with the persisted state.
    frontier.queue.length = 0
    frontier.seen.clear()

    for (const url of state.seen) frontier.seen.add(url)
    for (const url of state.visited) frontier.visited.add(url)
    for (const entry of [...(state.inFlight ?? []), ...state.queue]) {
      if (
        !frontier.visited.has(entry.url) &&
        !frontier.queue.some((queued) => queued.url === entry.url)
      )
        frontier.queue.push(entry)
    }

    return frontier
  }
}
