import { hostOf, sameSite } from '../visibility/citation.js'
import type { SerpSource } from '../serp/types.js'

/**
 * What the web says about a brand, classified deterministically.
 *
 * The authority axis leads with mentions rather than links, and that ordering is not a style
 * choice: branded web mentions correlate **0.664** with AI Overview visibility, backlinks
 * correlate **0.218**, and 84% of AI citations come from earned media. Mention-building and
 * link-building are two different jobs, and an axis that opens with referring domains sends a
 * client to do the one that matters less.
 *
 * Everything here is a pure function over a source list. A model is never asked whether something
 * "counts as a mention" (ADR-0001): we asked a search engine for pages about the brand, and the
 * classification is domain arithmetic over what came back.
 */

/**
 * Platforms where a brand can post about itself.
 *
 * Kept separate from earned media because they are a different kind of evidence, not a lesser
 * one. A company's own LinkedIn post is a mention it wrote; a trade publication writing about it
 * is a mention it earned, and the research says the earned kind is what the answer engines draw
 * on. Counting them together would let a busy social calendar read as authority.
 *
 * Deliberately short and obvious. A long, cleverly-maintained list would drift and start making
 * judgements about what a "real" publication is, which is not a call a parser should be making.
 */
const SELF_PUBLISHED = new Set([
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
  'crunchbase.com',
  'yelp.com',
  'tripadvisor.com',
])

export interface MentionFootprint {
  /** Distinct domains that are neither the client's own site nor a self-publishing platform. */
  earnedDomains: string[]
  /** Distinct self-publishing platforms carrying the brand. */
  selfPublishedDomains: string[]
  /** The client writing about itself. Not authority, but not an error either. */
  ownedDomains: string[]
  /** Every source we matched, so a human can check the count by hand. */
  sources: SerpSource[]
}

/** Whether a host is a platform a brand can publish itself onto. */
function isSelfPublished(host: string): boolean {
  if (SELF_PUBLISHED.has(host)) return true
  // Subdomains too: a brand's own `acme.wordpress.com` is self-published, not earned.
  return [...SELF_PUBLISHED].some((platform) => host.endsWith(`.${platform}`))
}

/**
 * Sort a brand search's results into earned, self-published, and owned.
 *
 * Counted by **distinct domain**, not by result. Ten pages on one news site is one publication
 * that covered the brand, and counting it as ten would make a single press release look like a
 * campaign. The unit that matters is how many different places on the web talk about you.
 */
export function classifyMentions(
  sources: readonly SerpSource[],
  clientDomain: string,
): MentionFootprint {
  const earned = new Set<string>()
  const selfPublished = new Set<string>()
  const owned = new Set<string>()
  const seen: SerpSource[] = []

  for (const source of sources) {
    const host = hostOf(source.url)
    if (!host) continue

    seen.push(source)

    if (sameSite(host, clientDomain)) owned.add(host)
    else if (isSelfPublished(host)) selfPublished.add(host)
    else earned.add(host)
  }

  return {
    earnedDomains: [...earned].sort(),
    selfPublishedDomains: [...selfPublished].sort(),
    ownedDomains: [...owned].sort(),
    sources: seen,
  }
}

/**
 * The search query that finds earned mentions of a brand.
 *
 * Quoted, so "Heartbeest Safaris" is not matched as two loose words on any page containing
 * "safaris". Excluding the client's own site with a search operator is what makes the result
 * *earned* media by construction, rather than something we filter afterwards and hope: their own
 * site would otherwise dominate the first page of results for their own brand name, and we would
 * be paying for a page of results we intend to discard.
 */
export function mentionQuery(brand: string, clientDomain: string): string {
  const host = hostOf(clientDomain)
  const quoted = `"${brand.replace(/"/g, '')}"`
  return host ? `${quoted} -site:${host}` : quoted
}
