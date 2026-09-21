/**
 * Does this page sell links?
 *
 * The filter that has to run before any "sites that accept contributors" list is shown to
 * anybody, and the reason the feature is buildable at all. LinkSeeker's version of this takes a
 * niche and returns 44 sites "actively seeking guest contributors", emailed as a PDF. A good share
 * of those, for any commercial niche, are selling placements, and buying one is the tactic
 * Google's link spam policy names by description. CLAUDE.md rule 7 forbids us to recommend it, so
 * a list we cannot filter is a list we cannot ship.
 *
 * This reads the page a candidate publishes about contributing. A site that wants writers says
 * what it wants to read; a site that wants money says what it costs, and it says so plainly
 * because its customers are searching for exactly that. The signals below are that plainness.
 *
 * Deterministic, and deliberately not a model's judgement (ADR-0001). A model asked "is this a
 * link farm?" would be right most of the time and unaccountable every time, and the cost of a
 * wrong yes is a client's money spent on a penalty.
 */

/**
 * Phrases that mean somebody is selling a placement.
 *
 * Each one is a phrase a paid-link page uses about itself, not a word that happens to appear near
 * money. "Price" alone would match a tile retailer's own price list; "price per post" would not.
 */
const SELLING = [
  'sponsored post',
  'sponsored article',
  'paid guest post',
  'paid post',
  'paid article',
  'guest post price',
  'price per post',
  'cost per post',
  'per post price',
  'link insertion',
  'niche edit',
  'dofollow link',
  'do-follow link',
  'permanent link',
  'buy a link',
  'buy links',
  'link placement',
  'publishing fee',
  'posting fee',
  'payment is required',
  'we charge',
  'our rates',
  'rate card',
]

/**
 * Phrases that mean somebody wants writing.
 *
 * Present so a page can be read as *contributor guidelines* rather than merely "not obviously a
 * shop". A page with neither signal is not an opportunity, it is a page that happened to match a
 * search.
 */
const INVITING = [
  'write for us',
  'contribute',
  'contributor',
  'guest post',
  'guest author',
  'submit an article',
  'submit a post',
  'submission guidelines',
  'pitch us',
  'pitch an idea',
  'editorial guidelines',
  'become an author',
]

/**
 * A currency amount next to a contribution word.
 *
 * The strongest single signal, and the one a page cannot phrase its way around: a guidelines page
 * that quotes a number in money is selling. Matched within a short window so a footer's pricing
 * link does not condemn an editorial page three screens above it.
 */
const PRICED_NEARBY =
  /(guest post|sponsored|contribut\w*|article|placement|link)[^.]{0,80}?(\$|usd|eur|£|€|\bkes\b|\bper\b\s*(post|article|link))/i

export type ContributorVerdict = 'inviting' | 'selling' | 'neither'

export interface ContributorCheck {
  verdict: ContributorVerdict
  /** The phrases that decided it, so a human can disagree with the specific evidence. */
  matched: string[]
}

/**
 * Read a page and decide what it is offering.
 *
 * Selling beats inviting whenever both appear, and that precedence is the whole safety property:
 * paid-link pages almost always also say "write for us", because that is what their customers
 * search for. A filter that let "inviting" win would pass nearly every seller.
 */
export function classifyContributorPage(html: string): ContributorCheck {
  // Tags out, so a class name like "sponsored-posts" in the markup does not condemn a page whose
  // visible text never mentions money, and so a hidden "buy links" block cannot hide behind one.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()

  const selling = SELLING.filter((phrase) => text.includes(phrase))
  if (PRICED_NEARBY.test(text)) selling.push('a price quoted next to a contribution offer')

  if (selling.length > 0) return { verdict: 'selling', matched: selling }

  const inviting = INVITING.filter((phrase) => text.includes(phrase))
  if (inviting.length > 0) return { verdict: 'inviting', matched: inviting }

  return { verdict: 'neither', matched: [] }
}

/**
 * The searches that find pages inviting contributors in a niche.
 *
 * Plain Google queries, because that is what the data source sells. Each one is a separate billed
 * query, so the list is short and the caller decides how many to run.
 *
 * Note what is missing: no `"paid guest post"` query. Searching for sellers to then exclude them
 * would be spending a client's money to build a list we intend to throw away, and the page-level
 * filter catches them anyway when they show up in the honest queries, which they do.
 */
export function contributorQueries(niche: string, locale?: string): string[] {
  const subject = niche.trim()
  const place = locale?.trim() ? ` ${locale.trim()}` : ''

  return [
    `"${subject}"${place} "write for us"`,
    `"${subject}"${place} "submission guidelines"`,
    `"${subject}"${place} "become a contributor"`,
  ]
}
