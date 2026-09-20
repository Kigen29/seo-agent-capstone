import { parseFinding, type Finding } from '@seo/core'
import type { LinkGap, LinkGapDomain } from '../backlinks/types.js'

/**
 * The link gap, classified before anybody is asked to act on it.
 *
 * Every competitor tool ships this list raw: "here are the domains linking to your rivals but not
 * to you, go get links". The first real query this seam ever made, against two large SEO sites,
 * returned `60detiknewss.com`, `expert-ia-seo.fr` and a page of link farms. Handing that to a
 * client as an opportunity list is worse than handing them nothing, because acting on it means
 * acquiring exactly the links Google's link spam policy exists to discount.
 *
 * So the raw list is never the output. Every domain is sorted into one of four buckets and only
 * two of them are work:
 *
 *   - **spam**: excluded, counted, and named in the finding so the exclusion is visible rather
 *     than a silent filter the client has to trust.
 *   - **platform**: a site anybody can post to. Not an outreach target, because "getting a link"
 *     there means making an account, which is not what the finding is for.
 *   - **directory**: a citation source. This belongs to the local axis, where a consistent listing
 *     is the point, rather than to an outreach campaign.
 *   - **editorial**: somebody made a decision to link. These are the only real outreach targets,
 *     and they are what the finding leads with.
 *
 * Classification is domain arithmetic over what the vendor returned plus two fixed lists. No model
 * decides what counts as a publication (ADR-0001), and no page is fetched to find out.
 */

/**
 * The vendor's spam score above which a domain is not an opportunity.
 *
 * DataForSEO scores 0 to 100. Thirty is deliberately cautious in the direction of dropping a
 * borderline site: the cost of excluding a real publication is one missed email, and the cost of
 * including a link farm is a client buying into a link scheme on our recommendation (CLAUDE.md
 * rule 7). The excluded count is always reported, so the judgement is auditable rather than
 * hidden.
 */
export const SPAM_SCORE_LIMIT = 30

/**
 * A rank of zero on a domain with real link volume is the other spam signal.
 *
 * The vendor's rank is 0 to 1000. A domain that has thousands of outbound links to three unrelated
 * businesses and no authority at all is a link farm by construction, whatever its spam score says.
 */
const NO_RANK_BACKLINKS = 1000

/**
 * Sites anybody can publish to. Shared in spirit with the mention classifier's list, kept separate
 * because the question differs: there, "did the brand write this itself"; here, "is asking for a
 * link from this a real outreach task". A subdomain counts.
 */
const PLATFORMS = [
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'tiktok.com',
  'youtube.com',
  'pinterest.com',
  'reddit.com',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'wixsite.com',
  'tumblr.com',
  'quora.com',
  'github.com',
  'substack.com',
]

/**
 * Directories and citation sources.
 *
 * Short, obvious, and not an attempt to enumerate the web's directories, which is a list that
 * cannot be maintained honestly. What it does is stop the most common citation sources being
 * presented as journalism to pitch, and route them to the axis where a listing actually matters.
 */
const DIRECTORIES = [
  'yelp.com',
  'yellowpages.com',
  'yellowpageskenya.com',
  'brownbook.net',
  'cylex.com',
  'hotfrog.com',
  'foursquare.com',
  'tripadvisor.com',
  'trustpilot.com',
  'crunchbase.com',
  'bbb.org',
  'manta.com',
  'thomasnet.com',
  'europages.com',
  'kompass.com',
]

export type GapKind = 'editorial' | 'directory' | 'platform' | 'spam'

export interface ClassifiedGapDomain extends LinkGapDomain {
  kind: GapKind
  /** Why it was classified this way, in the words the finding will use. */
  reason: string
}

const matches = (host: string, list: readonly string[]): boolean =>
  list.some((entry) => host === entry || host.endsWith(`.${entry}`))

/** Sort one gap domain into its bucket. Spam wins over everything: it is a refusal, not a label. */
export function classifyGapDomain(domain: LinkGapDomain): ClassifiedGapDomain {
  if (domain.spamScore !== undefined && domain.spamScore >= SPAM_SCORE_LIMIT) {
    return {
      ...domain,
      kind: 'spam',
      reason: `spam score ${domain.spamScore} of 100`,
    }
  }

  if (domain.rank === 0 && (domain.backlinks ?? 0) >= NO_RANK_BACKLINKS) {
    return {
      ...domain,
      kind: 'spam',
      reason: `no authority at all, with ${domain.backlinks?.toLocaleString()} links out`,
    }
  }

  if (matches(domain.domain, DIRECTORIES)) {
    return { ...domain, kind: 'directory', reason: 'a directory listing, not editorial coverage' }
  }

  if (matches(domain.domain, PLATFORMS)) {
    return { ...domain, kind: 'platform', reason: 'a platform anybody can post to' }
  }

  return { ...domain, kind: 'editorial', reason: 'somebody chose to link to your competitors' }
}

export interface ClassifiedGap {
  editorial: ClassifiedGapDomain[]
  directory: ClassifiedGapDomain[]
  platform: ClassifiedGapDomain[]
  /** Refused, and reported: a filter nobody can see is a filter nobody can check. */
  spam: ClassifiedGapDomain[]
}

export function classifyGap(gap: LinkGap): ClassifiedGap {
  const out: ClassifiedGap = { editorial: [], directory: [], platform: [], spam: [] }

  for (const domain of gap.domains) {
    const classified = classifyGapDomain(domain)
    out[classified.kind].push(classified)
  }

  return out
}

/**
 * The fewest editorial targets worth raising.
 *
 * The same reasoning as the unlinked-mention floor: one or two is not a campaign, and a finding
 * that fires on a single domain would nag every site with a competitor.
 */
export const MIN_GAP_DOMAINS = 3

export interface LinkGapFindingInput {
  siteId: string
  gap: LinkGap
  classified: ClassifiedGap
  observedAt?: string
}

/**
 * AUTH-005: publications that link to every tracked competitor and not to you.
 *
 * Note what this finding is not. It is not "you have too few backlinks", which is the finding
 * every other tool leads with, has no falsification worth the name, and sends a client to buy
 * links (ADR-0021 rejects it explicitly). This is a named list of sites that have already decided
 * to link to businesses exactly like theirs, which is a morning of email with a real hit rate.
 */
export function linkGapFinding(input: LinkGapFindingInput): Finding[] {
  const { gap, classified } = input
  if (classified.editorial.length < MIN_GAP_DOMAINS) return []

  const observedAt = input.observedAt ?? new Date().toISOString()
  const named = classified.editorial.slice(0, 3).map((entry) => entry.domain)
  const refused = classified.spam.length

  return [
    parseFinding({
      id: 'AUTH-005#0',
      siteId: input.siteId,
      ruleId: 'AUTH-005',
      axis: 'authority',
      severity: 'medium',
      confidence: 1,
      estimatedImpact: 50,
      // Email, one publication at a time, with something worth saying. Real work, not a campaign.
      estimatedEffort: 'medium',
      title:
        `${classified.editorial.length} publication(s) link to ${gap.targets.join(', ')} ` +
        `and not to you, including ${named.join(', ')}`,
      evidence: {
        kind: 'metric',
        observedAt,
        source: 'serp',
        metric: `Editorial domains linking to every one of ${gap.targets.join(', ')} but not ${gap.excluded}`,
        value: classified.editorial.length,
        unit: 'count',
      },
      affectedUrls: [],
      // Rule 6: we draft, humans send. Nothing here is a diff.
      fixable: false,
      status: 'open',
      falsification:
        `Open the named domains and check they actually link to ${gap.targets.join(' and ')}. ` +
        `A working effort moves domains off this list and onto your own referring-domain list ` +
        `over the following months. This finding is wrong if these sites sell links rather than ` +
        `earning them, which is what the ${refused} domain(s) excluded as spam here already ` +
        `were: buying from them would cost more than the missing links do. The comparison covers ` +
        `the top ${gap.limit} of ${gap.total} domain(s) the vendor found, ordered by authority, ` +
        `so it is a slice rather than a census.`,
    }),
  ]
}
