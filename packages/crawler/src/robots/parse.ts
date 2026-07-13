/**
 * robots.txt parser, per RFC 9309 plus the de facto extensions every real crawler
 * supports (wildcards, `$`, Sitemap) and Cloudflare's Content-Signals syntax.
 *
 * Parsing is deliberately forgiving: robots.txt files in the wild are full of typos,
 * BOMs, stray colons and unknown directives. A parse error must never be reported as
 * "this site blocks AI crawlers", because that would be a false positive on the single
 * highest-severity rule we ship.
 */

export type RuleType = 'allow' | 'disallow'

export interface RobotsRule {
  type: RuleType
  /** The raw path pattern, wildcards intact. Empty string means "no restriction". */
  pattern: string
}

/**
 * Cloudflare's Content-Signals, e.g. `Content-Signal: search=yes, ai-train=no`.
 *
 * These express intent, not access control. Nothing enforces them. We surface them
 * because from 15 September 2026 Cloudflare applies new defaults to un-reviewed
 * free-tier domains, and a site that signals ai-train=no can find multi-purpose
 * crawlers caught by the most restrictive applicable rule.
 */
export type ContentSignals = Record<string, string>

export interface RobotsGroup {
  /** Lowercased product tokens this group applies to. '*' is the catch-all. */
  userAgents: string[]
  rules: RobotsRule[]
  crawlDelay?: number
  contentSignals?: ContentSignals
}

export interface RobotsTxt {
  groups: RobotsGroup[]
  /** Sitemap is not tied to any user agent, so it lives outside the groups. */
  sitemaps: string[]
  /** True when the file was absent or unfetchable. Absent robots.txt means allow all. */
  absent: boolean
}

export const ALLOW_ALL: RobotsTxt = { groups: [], sitemaps: [], absent: true }

function stripComment(line: string): string {
  const hash = line.indexOf('#')
  return hash === -1 ? line : line.slice(0, hash)
}

function parseContentSignals(value: string): ContentSignals {
  const signals: ContentSignals = {}

  for (const pair of value.split(',')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue

    const key = pair.slice(0, eq).trim().toLowerCase()
    const val = pair
      .slice(eq + 1)
      .trim()
      .toLowerCase()
    if (key) signals[key] = val
  }

  return signals
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []

  let current: RobotsGroup | undefined
  /**
   * Consecutive user-agent lines share one group. The first rule line closes the
   * header, so a user-agent line after a rule starts a new group. Getting this wrong
   * silently merges unrelated groups and is the classic robots parser bug.
   */
  let acceptingAgents = false

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim()
    if (!line) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue // not a directive; ignore rather than throw

    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    switch (field) {
      case 'user-agent': {
        if (!value) break

        if (!current || !acceptingAgents) {
          current = { userAgents: [], rules: [] }
          groups.push(current)
          acceptingAgents = true
        }
        current.userAgents.push(value.toLowerCase())
        break
      }

      case 'allow':
      case 'disallow': {
        if (!current) break // a rule before any user-agent line applies to nobody
        acceptingAgents = false
        current.rules.push({ type: field, pattern: value })
        break
      }

      case 'crawl-delay': {
        if (!current) break
        acceptingAgents = false
        const delay = Number(value)
        if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay
        break
      }

      case 'content-signal': {
        if (!current) break
        acceptingAgents = false
        current.contentSignals = { ...current.contentSignals, ...parseContentSignals(value) }
        break
      }

      case 'sitemap': {
        // Group-independent by spec, so it does not close the user-agent header.
        if (value) sitemaps.push(value)
        break
      }

      default:
        break // unknown directive, ignore
    }
  }

  return { groups, sitemaps, absent: false }
}
