import { parseFinding, type Finding } from '@seo/core'
import type { ReferringDomains } from '../backlinks/types.js'
import { sameSite } from '../visibility/citation.js'
import type { MentionFootprint } from './mentions.js'

/**
 * Turn a brand's mention footprint into authority findings, deterministically.
 *
 * The judge, kept apart from the paid query that fetched the data, exactly as `crux/evaluate.ts`
 * is kept apart from `crux/client.ts`. It is a pure function of what came back, so it is tested
 * against fixtures with no key and no spend.
 *
 * Two things this axis refuses to do, both of them the industry default:
 *
 *   1. **Lead with links.** Branded web mentions correlate 0.664 with AI Overview visibility;
 *      backlinks correlate 0.218. Every finding here is about mentions, and referring domains are
 *      reported as unmeasured rather than as a number we do not have.
 *   2. **Count results instead of publications.** Ten pages on one news site is one publication
 *      that covered you. The unit is a distinct domain, throughout.
 */

/**
 * Below this many distinct earned domains, a brand has a footprint problem rather than a ranking
 * problem. It is a deliberately low bar: the finding is meant to fire for a business the web has
 * barely noticed, not to nag one with a respectable presence into chasing a bigger number.
 */
export const THIN_FOOTPRINT = 5

/**
 * The share of a footprint that may be self-published before it is worth saying out loud. Half is
 * generous on purpose. Social presence is not a fault, and this finding is about a footprint that
 * is *mostly* the brand talking about itself, which is a different situation from a brand that
 * simply also posts.
 */
const SELF_PUBLISHED_SHARE = 0.5

/**
 * The fewest unlinked mentions worth raising as work.
 *
 * One or two is noise: a journalist who did not link is not a campaign, and a finding that fires
 * on a single one would nag every brand the web has ever noticed. Three is where a pattern starts
 * and where an afternoon of outreach has enough targets to be worth planning.
 */
export const MIN_UNLINKED_MENTIONS = 3

export interface AuthorityInput {
  siteId: string
  brand: string
  footprint: MentionFootprint
  /** Competitor footprints, by domain. Empty when none are configured or none were queried. */
  competitors: { domain: string; earnedDomains: number }[]
  /**
   * Referring domains, when a backlink index is configured. Optional on purpose: this axis was
   * built to work without one and still must (ADR-0018). Absent, nothing here changes.
   */
  backlinks?: ReferringDomains
  observedAt?: string
}

export interface AuthorityReport {
  findings: Finding[]
  /** Distinct earned-media domains. The axis's headline number. */
  earnedCount: number
  /**
   * Earned-media domains that mention the brand without linking to it, when both signals are
   * available. Undefined when no backlink index is configured, which is not the same as an empty
   * array: one means we did not look, the other means we looked and everyone links.
   */
  unlinkedMentions?: string[]
}

/** The research sentence every one of these findings is grounded in. */
const RESEARCH =
  'Branded web mentions correlate 0.664 with AI Overview visibility while backlinks correlate ' +
  '0.218, and 84% of AI citations come from earned media, so mention-building and link-building ' +
  'are two different jobs.'

export function evaluateAuthority(input: AuthorityInput): AuthorityReport {
  const observedAt = input.observedAt ?? new Date().toISOString()
  const findings: Finding[] = []

  const earnedCount = input.footprint.earnedDomains.length
  const selfCount = input.footprint.selfPublishedDomains.length
  const total = earnedCount + selfCount

  /**
   * Left undefined when no backlink index is configured, and that distinction is load-bearing:
   * an empty array means we compared and everyone links, undefined means we never looked. The
   * two look identical on a dashboard and mean opposite things.
   */
  let unlinked: string[] | undefined

  const evidence = (metric: string, value: number) =>
    ({
      kind: 'metric' as const,
      observedAt,
      source: 'serp' as const,
      metric,
      value,
      unit: 'count' as const,
    }) satisfies Record<string, unknown>

  const shared = {
    siteId: input.siteId,
    axis: 'authority' as const,
    // We counted domains in a result set. What to do about it is a judgement; the count is not.
    confidence: 1,
    affectedUrls: [],
    // Outreach is human work, and rule 6 says we draft but never send. Nothing here is a diff.
    fixable: false,
    status: 'open' as const,
  }

  // The competitive finding first: being out-mentioned on your own brand space is the one that
  // costs money, and it is the only one with a named opponent to act against.
  const ahead = input.competitors
    .filter((competitor) => competitor.earnedDomains > earnedCount)
    .sort((a, b) => b.earnedDomains - a.earnedDomains)

  if (ahead.length > 0) {
    const leader = ahead[0]!
    findings.push(
      parseFinding({
        ...shared,
        id: 'AUTH-001#0',
        ruleId: 'AUTH-001',
        severity: 'high',
        estimatedImpact: 65,
        estimatedEffort: 'large',
        title:
          `${leader.domain} is mentioned across ${leader.earnedDomains} earned-media domains ` +
          `to your ${earnedCount}`,
        evidence: evidence(`Earned-media domains mentioning ${input.brand}`, earnedCount),
        falsification:
          `Re-run the brand mention query after a digital-PR push. A working effort raises the ` +
          `count of distinct earned domains above ${earnedCount} and closes the gap to ` +
          `${leader.earnedDomains}. This finding was wrong if the count moves and AI-visibility ` +
          `citation rates do not follow over the next few poll windows. ${RESEARCH}`,
      }),
    )
  }

  if (earnedCount < THIN_FOOTPRINT) {
    findings.push(
      parseFinding({
        ...shared,
        id: 'AUTH-002#0',
        ruleId: 'AUTH-002',
        severity: 'medium',
        estimatedImpact: 55,
        estimatedEffort: 'large',
        title:
          `Only ${earnedCount} earned-media domain(s) mention ${input.brand}, ` +
          `which is a thin footprint`,
        evidence: evidence(`Earned-media domains mentioning ${input.brand}`, earnedCount),
        falsification:
          `Re-run the brand mention query after the next campaign. A working effort raises the ` +
          `distinct earned-domain count above ${THIN_FOOTPRINT}. This finding was wrong if the ` +
          `count is already higher on a query that matches how the press actually writes the ` +
          `brand name, which is worth checking before doing any outreach at all. ${RESEARCH}`,
      }),
    )
  }

  // Only worth saying when there is a footprint to describe. On a brand nobody mentions, this
  // would fire alongside AUTH-002 and say the same thing twice in a less useful way.
  if (total > 0 && earnedCount > 0 && selfCount / total > SELF_PUBLISHED_SHARE) {
    findings.push(
      parseFinding({
        ...shared,
        id: 'AUTH-003#0',
        ruleId: 'AUTH-003',
        severity: 'low',
        estimatedImpact: 35,
        estimatedEffort: 'medium',
        title:
          `${selfCount} of ${total} domains mentioning ${input.brand} are platforms you can ` +
          `post to yourself, not earned coverage`,
        evidence: evidence(`Self-published domains mentioning ${input.brand}`, selfCount),
        falsification:
          `Re-run the brand mention query later. A working effort grows the earned share, not ` +
          `the total. This finding was wrong if the self-published domains here are in fact ` +
          `independent coverage that happens to be hosted on a platform, which a human can ` +
          `settle in a minute by opening them. ${RESEARCH}`,
      }),
    )
  }

  /**
   * AUTH-004: the domains that already wrote about you and did not link.
   *
   * The only link-related finding on this axis, and it is deliberately not the one every other
   * tool raises. "You have few referring domains" is generic advice that sends a client to buy
   * links; a named list of publications that have *already covered them* is a specific afternoon
   * of work with a real hit rate, and unlinked-mention reclamation is a recognised tactic rather
   * than something invented here.
   *
   * It is also only computable because this axis leads with mentions. It is the set difference
   * between a footprint we gather anyway and an index we now fetch, and neither signal produces
   * it alone. That is the argument of ADR-0018 paying off rather than being softened: links enter
   * as a second signal that makes the first one more useful.
   */
  if (input.backlinks) {
    const linking = input.backlinks.domains

    unlinked = input.footprint.earnedDomains.filter(
      (mention) => !linking.some((link) => sameSite(link.domain, mention)),
    )

    if (unlinked.length >= MIN_UNLINKED_MENTIONS) {
      const truncated = input.backlinks.total > input.backlinks.limit

      findings.push(
        parseFinding({
          ...shared,
          id: 'AUTH-004#0',
          ruleId: 'AUTH-004',
          severity: 'medium',
          estimatedImpact: 60,
          // A named list of publications that already covered you is a morning of email, not a
          // campaign. This is the cheapest real link work on the axis, which is why it outranks
          // the thin-footprint finding on impact while costing less effort.
          estimatedEffort: 'medium',
          title:
            `${unlinked.length} domain(s) mention ${input.brand} without linking to it, ` +
            `including ${unlinked.slice(0, 3).join(', ')}`,
          evidence: evidence(
            'Earned-media domains mentioning the brand but not linking',
            unlinked.length,
          ),
          falsification:
            `Ask each of these publications for a link, then re-run this audit. A working effort ` +
            `moves domains off this list and onto the referring-domain list. This finding was ` +
            `wrong if any of them already links` +
            (truncated
              ? `: the comparison is against the top ${input.backlinks.limit} referring domains ` +
                `by authority, and this site has ${input.backlinks.total}, so a link from outside ` +
                `that slice would look like an absence here. Check the named domains before ` +
                `contacting anyone.`
              : `, which a human can settle by opening the page. The comparison covered all ` +
                `${input.backlinks.total} referring domain(s), so it is not a truncation artefact.`) +
            ` ${RESEARCH}`,
        }),
      )
    }
  }

  return {
    findings,
    earnedCount,
    ...(unlinked === undefined ? {} : { unlinkedMentions: unlinked }),
  }
}
