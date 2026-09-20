import { normaliseUrl, type CrawledPage } from '@seo/crawler'
import { markupEvidence } from '../evidence.js'
import type { Rule, RuleContext } from '../types.js'

/**
 * The phone number rules: what the markup says against what the page shows, and whether a local
 * site gives a visitor the two links a business profile makes possible.
 *
 * Both are on the local axis and both are deliberately narrow. Every "NAP consistency" feature on
 * the market compares a business's name, address and phone across dozens of external directories,
 * which needs a directory index we do not have and will not buy. What we can check exactly, from
 * the crawl alone, is whether a site contradicts *itself*, and that is worth doing first: an
 * address in the footer that disagrees with the address in the structured data is the site telling
 * Google and a human two different things, and it is the version that a client can fix today.
 */

/** A phone number in visible text. Deliberately loose; normalisation does the real work. */
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/g

/**
 * The comparable core of a phone number: its last nine digits.
 *
 * `+254 700 123 456` and `0700 123 456` are the same number written two ways, and comparing them
 * as strings, or even as full digit runs, would report drift on a site that is perfectly
 * consistent. The national significant number is what survives both the country code and the
 * trunk zero, so the tail is what gets compared. Nine digits is short enough to cover Kenya, the
 * UK and the US, and long enough that two genuinely different numbers do not collide.
 */
const NINE_DIGITS = 9

export function phoneKey(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length < NINE_DIGITS) return null
  return digits.slice(-NINE_DIGITS)
}

type JsonObject = Record<string, unknown>

function flattenNodes(blocks: readonly unknown[]): JsonObject[] {
  const out: JsonObject[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === 'object') {
      const node = value as JsonObject
      if ('@graph' in node) visit(node['@graph'])
      out.push(node)
    }
  }
  blocks.forEach(visit)
  return out
}

/** Every telephone the page's structured data declares, in document order. */
function schemaPhones(page: CrawledPage): string[] {
  return flattenNodes(page.extract.jsonLd)
    .map((node) => node['telephone'])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
}

/**
 * The page a rule about visible contact details should read: the homepage.
 *
 * Matched through `normaliseUrl` like the other local rules, so a trailing slash or a `www.` that
 * the crawl resolved differently from the seed does not quietly leave these rules with no page to
 * look at, which would read as "no problem found".
 */
function homepage(context: RuleContext): CrawledPage | undefined {
  const seed = normaliseUrl(context.seed) ?? context.seed
  return context.pages.find(
    (page) => page.status === 200 && (normaliseUrl(page.finalUrl) ?? page.finalUrl) === seed,
  )
}

/**
 * LOCAL-003: the phone number on the page is not the phone number in the structured data.
 *
 * Fires only when the page shows numbers *and* the markup declares one *and* none of them match,
 * which is the case where the two are genuinely telling different stories. A page that shows no
 * number, or markup that declares none, is silent: that is LOCAL-001's territory, or simply a site
 * that does not publish a phone.
 *
 * Not fixable by a diff, and the reason is not effort. Which number is the right one is a fact
 * about the business that only the business knows: the structured data may be stale, or the footer
 * may be, and a fixer that picked one would have a one-in-two chance of publishing the wrong number
 * to Google in a machine-readable form.
 */
export const LOCAL_003: Rule = {
  id: 'LOCAL-003',
  axis: 'local',
  severity: 'medium',
  estimatedEffort: 'trivial',
  fixable: false,
  description:
    'The phone number in the structured data does not match any phone number shown on the page.',

  evaluate: (context) => {
    const home = homepage(context)
    if (!home) return []

    const declared = schemaPhones(home)
    if (declared.length === 0) return []

    const declaredKeys = new Set(
      declared.map(phoneKey).filter((key): key is string => key !== null),
    )
    if (declaredKeys.size === 0) return []

    // Visible text only. The rendered DOM's text is what a human reads; a number that appears
    // solely in a script or an attribute is not a number the site is showing anybody.
    const shown = [...(home.extract.text.match(PHONE) ?? [])]
      .map((raw) => ({ raw: raw.trim(), key: phoneKey(raw) }))
      .filter((entry): entry is { raw: string; key: string } => entry.key !== null)

    if (shown.length === 0) return []
    if (shown.some((entry) => declaredKeys.has(entry.key))) return []

    const visible = [...new Set(shown.map((entry) => entry.raw))].slice(0, 5)

    return [
      {
        title:
          `${home.finalUrl} shows ${visible.join(', ')} but its structured data declares ` +
          `${declared.join(', ')}`,
        evidence: markupEvidence(
          home,
          'script[type="application/ld+json"] telephone, and the page text',
          JSON.stringify({ declared, visible }),
        ),
        affectedUrls: [home.finalUrl],
        // High but not certain: a site can legitimately show a sales line in the body and mark up
        // its head office. The finding says which is which and lets a human settle it.
        confidence: 0.8,
        estimatedImpact: 30,
        falsification:
          'Ring both numbers. If they reach the same business, this is two legitimate lines and ' +
          'not an inconsistency, so close it. Otherwise decide which is correct and make the ' +
          'page and the structured data agree; a re-crawl then finds a match and this closes.',
      },
    ]
  },
}

/** Does the page link to, or embed, this Google profile anywhere? */
function mentions(page: CrawledPage, needles: string[]): boolean {
  const html = page.renderedHtml.toLowerCase()
  return needles.some((needle) => html.includes(needle.toLowerCase()))
}

/**
 * LOCAL-004: the site has a connected profile and does not use it anywhere a visitor can see.
 *
 * Two links, both of which exist only because the client connected a profile: a map that proves
 * where the business is, and a direct review link. Reviews are the strongest lever a local business
 * has, and the difference between "leave us a review" and a link that opens the review box is most
 * of whether anybody does.
 *
 * Deliberately `info`, and deliberately not fixable. This changes what visitors see, which is a
 * design decision and not something an agent should merge into somebody's homepage unasked. The
 * finding carries the exact links, so acting on it is a copy and a paste.
 */
export const LOCAL_004: Rule = {
  id: 'LOCAL-004',
  axis: 'local',
  severity: 'info',
  estimatedEffort: 'trivial',
  fixable: false,
  description:
    'The connected Google Business Profile is not linked from the site: no map, no review link.',

  evaluate: (context) => {
    const cid = context.businessProfile?.cid
    if (!cid) return []

    const home = homepage(context)
    if (!home) return []

    const profileUrl = `https://maps.google.com/?cid=${cid}`
    const placeId = context.businessProfile?.placeId ?? null
    const reviewUrl = placeId
      ? `https://search.google.com/local/writereview?placeid=${placeId}`
      : null

    // Any Google-maps reference counts as a map: an embedded iframe, a "find us" link, a static
    // map image. The finding is about a visitor having no way through to the profile at all, not
    // about which of the several correct ways they used.
    const hasMap = mentions(home, ['maps.google.', 'google.com/maps', 'maps.app.goo.gl', 'g.page'])
    const hasReview = mentions(home, ['writereview', 'local/writereview'])

    if (hasMap && hasReview) return []

    const missing = [hasMap ? null : 'a map or profile link', hasReview ? null : 'a review link']
      .filter((entry): entry is string => entry !== null)
      .join(' and ')

    return [
      {
        title: `${home.finalUrl} has a connected Google Business Profile but no ${missing}`,
        evidence: markupEvidence(
          home,
          'a[href], iframe[src]',
          JSON.stringify({ profileUrl, reviewUrl, hasMap, hasReview }),
        ),
        affectedUrls: [home.finalUrl],
        confidence: 1,
        estimatedImpact: 15,
        falsification:
          `Re-crawl ${home.finalUrl} after adding the links. This closes when the page carries ` +
          `${profileUrl}` +
          (reviewUrl ? ` and ${reviewUrl}` : ', and a review link once a Place ID is connected') +
          '. If review volume does not move over the following months, the links were not the ' +
          'constraint; asking customers is.',
      },
    ]
  },
}
