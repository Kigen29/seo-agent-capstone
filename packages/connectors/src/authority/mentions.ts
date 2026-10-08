import { hostOf, sameSite } from '../visibility/citation.js'
import type { SerpSource } from '../serp/types.js'
import { DIRECTORIES, matches, PLATFORMS } from './platforms.js'

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
 * Platforms where a brand can post about itself, and directories where it lists itself.
 *
 * Kept separate from earned media because they are a different kind of evidence, not a lesser
 * one. A company's own LinkedIn post is a mention it wrote; a trade publication writing about it
 * is a mention it earned, and the research says the earned kind is what the answer engines draw
 * on. Counting them together would let a busy social calendar read as authority. A directory
 * listing is the same: the business filled it in.
 *
 * Deliberately short and obvious, and shared with the link gap (platforms.ts). A long,
 * cleverly-maintained list would drift and start making judgements about what a "real"
 * publication is, which is not a call a parser should be making.
 */
const SELF_PUBLISHED: readonly string[] = [...PLATFORMS, ...DIRECTORIES]

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
  // Subdomains too: a brand's own `acme.wordpress.com` is self-published, not earned.
  return matches(host, SELF_PUBLISHED)
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

/** One page that mentions the brand, kept so a person can open it and read the mention. */
export interface MentionPage {
  url: string
  domain: string
  /** The page's own title, as the search result gave it. */
  title?: string
  /** Independent coverage, or a platform the business can post to itself. */
  kind: 'earned' | 'self_published'
  /**
   * Whether that site links to the client. Undefined when no backlink index was consulted,
   * which is not the same as false: unknown must not be shown as "no link".
   */
  linked?: boolean
}

/** Enough to read in one sitting. The count on the page is of domains and is not capped by this. */
export const MAX_MENTION_PAGES = 100

const MAX_TITLE = 200

/**
 * The pages behind the count.
 *
 * The axis used to keep only how many domains mentioned the brand. That is a number nobody can
 * check: "six sites wrote about you" invites the question "which, and saying what?", and the
 * answer had been thrown away one line after it was fetched. This keeps it.
 *
 * Pages on the client's own site are left out, because a site mentioning itself is not a mention.
 * Only http and https addresses are kept: these are rendered as links, and a search result is
 * third-party data that has no business supplying a `javascript:` address.
 *
 * Earned coverage first, then by site, so the pages worth reading lead and one site's pages sit
 * together.
 */
export function listMentions(
  footprint: MentionFootprint,
  clientDomain: string,
  /** The AUTH-004 list. Pass it when links were checked, and omit it when they were not. */
  unlinkedDomains?: readonly string[],
): MentionPage[] {
  const seen = new Set<string>()
  const pages: MentionPage[] = []

  for (const source of footprint.sources) {
    const host = hostOf(source.url)
    if (!host || sameSite(host, clientDomain)) continue
    if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) continue
    seen.add(source.url)

    const kind = isSelfPublished(host) ? 'self_published' : 'earned'
    const title = source.title?.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)

    pages.push({
      url: source.url,
      domain: host,
      ...(title ? { title } : {}),
      kind,
      // Only earned coverage is compared with the link index; a platform profile is not a pitch.
      ...(unlinkedDomains && kind === 'earned'
        ? { linked: !unlinkedDomains.some((domain) => sameSite(domain, host)) }
        : {}),
    })
  }

  return pages
    .sort(
      (a, b) =>
        Number(a.kind === 'self_published') - Number(b.kind === 'self_published') ||
        a.domain.localeCompare(b.domain) ||
        a.url.localeCompare(b.url),
    )
    .slice(0, MAX_MENTION_PAGES)
}

/**
 * Letters and digits only, lower case, accents removed, everything else a single space.
 *
 * So "Heartbeest  Safaris", "heartbeest-safaris" and "HEARTBEEST SAFARIS" are one name, and a
 * page is not refused for a hyphen or a capital.
 */
function plain(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Whether the name appears in the text as whole words, in order. */
function names(text: string | undefined, name: string): boolean {
  if (!text || !name) return false
  return ` ${plain(text)} `.includes(` ${name} `)
}

export interface ConfirmedMentions {
  /** Results whose own text contains the name as written. */
  confirmed: SerpSource[]
  /** Results the search returned that do not. Kept as a count, so the filtering can be seen. */
  rejected: SerpSource[]
}

/**
 * Keep only the search results that really contain the name that was searched for.
 *
 * A search engine does not return what was asked for; it returns what it thinks was meant. Asked
 * for "Heartbeest Safaris" in quotes, Google decided the word was a misspelling of "hartebeest",
 * the antelope, and returned pages about African Hartebeest Safaris, a different company. Every
 * one was counted as a mention of the client, listed with a link, and offered as a publication to
 * email. The axis was confidently describing somebody else's business.
 *
 * So a result is a mention only if its own title, summary or address contains the name, exactly
 * as written, as whole words. That is a parser deciding, not a search engine's guess and not a
 * model's (rule 1). The title and the summary are the search engine's own extract of the page,
 * and the summary is the passage that matched, so a page that truly names the brand shows it
 * there.
 *
 * It errs towards leaving a real mention out. A summary cut short before the name, or a name
 * written differently on the page, is lost; that costs a count that is slightly low. The other
 * direction costs a client emailing six strangers about articles that were never about them.
 */
export function confirmMentions(sources: readonly SerpSource[], brand: string): ConfirmedMentions {
  const name = plain(brand)
  const confirmed: SerpSource[] = []
  const rejected: SerpSource[] = []

  for (const source of sources) {
    let address = source.url
    try {
      const parsed = new URL(source.url)
      address = decodeURIComponent(`${parsed.hostname} ${parsed.pathname}`)
    } catch {
      // Left as it came. A malformed address simply will not match.
    }

    if (names(source.title, name) || names(source.snippet, name) || names(address, name)) {
      confirmed.push(source)
    } else {
      rejected.push(source)
    }
  }

  return { confirmed, rejected }
}
