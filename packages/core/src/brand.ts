/**
 * The brand name, read from a homepage title when the title plainly states it.
 *
 * ADR-0018 says the brand is stored and not derived from the domain, and this keeps to that. A
 * domain gives `heartbeestsafaris`, a string the press has never written; the homepage title
 * gives "Heartbeest Safaris | Kenya safari tours", which is the business saying its own name. So
 * the name is taken from the title, and the domain is used only to tell which part of the title
 * is the name and which is the tagline.
 *
 * When no part of the title matches the domain, this returns null and somebody types the name.
 * A wrong brand is worse than a blank one: every mention search and every outreach draft is built
 * on it, and a blank at least gets noticed.
 */

/**
 * Titles join a name and a tagline with one of these. A dash counts only with a space either side,
 * so a hyphenated name stays whole; a colon counts when a space follows it, as in "Name: tagline".
 */
const SEPARATOR = /\s+[|–—·•-]\s+|\s*[|·•]\s*|:\s+/

const MAX_BRAND = 80

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** `www.heartbeestsafaris.co.ke` gives `heartbeestsafaris`: the label the owner chose. */
function stemOf(siteUrl: string): string | null {
  try {
    const host = new URL(siteUrl).hostname.replace(/^www\./, '')
    return squash(host.split('.')[0] ?? '') || null
  } catch {
    return null
  }
}

export function brandFromTitle(title: string | null | undefined, siteUrl: string): string | null {
  const stem = stemOf(siteUrl)
  if (!title || !stem) return null

  const segments = title
    .split(SEPARATOR)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length > 0 && segment.length <= MAX_BRAND)

  // The segment that is the domain, letter for letter, once spaces and punctuation are gone.
  const exact = segments.find((segment) => squash(segment) === stem)
  if (exact) return exact

  /**
   * Or one that begins with the domain, or that the domain begins with: "Solian Girls High
   * School" for `soliangirls`, "Rangau" for `rangautiles`. Bounded both ways, so a short word
   * at the start of a long domain is not a brand, and neither is a long line that starts with it.
   */
  const near = segments.find((segment) => {
    const squashed = squash(segment)
    if (squashed.length < 4) return false
    // A name leads with itself. "Named Safaris" begins with `named`; "Book with Named today"
    // contains it and is a sentence, not a name.
    if (squashed.startsWith(stem)) return squashed.length <= stem.length * 3
    return stem.startsWith(squashed) && squashed.length * 2 >= stem.length
  })

  return near ?? null
}
