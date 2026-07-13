import type { RobotsGroup, RobotsRule, RobotsTxt } from './parse.js'

/**
 * Rule matching, per Google's published interpretation of RFC 9309:
 *
 *   - The applicable group is the one with the MOST SPECIFIC matching user agent.
 *   - Within it, the applicable rule is the one with the LONGEST path pattern.
 *   - On a tie, the LEAST RESTRICTIVE rule wins, so allow beats disallow.
 *
 * That last one is the rule people get wrong, and getting it wrong means reporting a
 * site as blocked when it is not. On the AI crawler check that is a false positive on
 * a critical finding, which is the exact failure the story's falsification names.
 */

/** `Googlebot/2.1` and `googlebot` are the same crawler. Version numbers are noise. */
function normaliseAgent(userAgent: string): string {
  const token = userAgent.trim().toLowerCase().split('/')[0] ?? ''
  return token.trim()
}

/**
 * Turn a robots path pattern into a regex.
 * `*` matches zero or more characters. A trailing `$` anchors the end of the URL.
 * Everything else is a literal, and a pattern matches as a prefix of the path.
 */
function patternToRegExp(pattern: string): RegExp {
  let body = pattern
  let anchorEnd = false

  if (body.endsWith('$')) {
    anchorEnd = true
    body = body.slice(0, -1)
  }

  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')

  return new RegExp(`^${escaped}${anchorEnd ? '$' : ''}`)
}

function ruleMatches(rule: RobotsRule, path: string): boolean {
  if (rule.pattern === '') return false // `Disallow:` with no value restricts nothing
  return patternToRegExp(rule.pattern).test(path)
}

/**
 * The group whose user-agent token is the longest match. Falls back to the `*` group.
 * Returns undefined when nothing matches at all, which means no restrictions apply.
 */
export function selectGroup(robots: RobotsTxt, userAgent: string): RobotsGroup | undefined {
  const agent = normaliseAgent(userAgent)

  let best: RobotsGroup | undefined
  let bestLength = -1

  for (const group of robots.groups) {
    for (const token of group.userAgents) {
      const specificity = token === '*' ? 0 : token === agent ? token.length : -1
      if (specificity > bestLength) {
        bestLength = specificity
        best = group
      }
    }
  }

  return best
}

/** The path a robots rule is matched against: the path plus any query string. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    // Already a path, not an absolute URL.
    return url.startsWith('/') ? url : `/${url}`
  }
}

export function isAllowed(robots: RobotsTxt, userAgent: string, url: string): boolean {
  if (robots.absent) return true

  const group = selectGroup(robots, userAgent)
  if (!group) return true

  const path = pathOf(url)

  let verdict = true
  let winning = -1

  for (const rule of group.rules) {
    if (!ruleMatches(rule, path)) continue

    const specificity = rule.pattern.length

    if (specificity > winning) {
      winning = specificity
      verdict = rule.type === 'allow'
    } else if (specificity === winning && rule.type === 'allow') {
      verdict = true // tie goes to the least restrictive rule
    }
  }

  return verdict
}

/** Crawl-delay for this agent, if the site asked for one. We honour it. */
export function crawlDelayFor(robots: RobotsTxt, userAgent: string): number | undefined {
  return selectGroup(robots, userAgent)?.crawlDelay
}
