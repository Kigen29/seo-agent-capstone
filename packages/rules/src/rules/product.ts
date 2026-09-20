import type { CrawledPage } from '@seo/crawler'
import { indexableHtmlPages, markupEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

/**
 * The product page rules: whether a shop's products are marked up well enough to appear as
 * products, and whether the price in the markup is the price on the page.
 *
 * These exist because the advice usually given about product pages is wrong in a specific way.
 * The popular version is "add more content": specifications, a how-to, an FAQ block, a comparison
 * table, until the page passes some word count. Length is not the lever, FAQ rich results were
 * switched off for every site on 7 May 2026, and about 85% of page-one results already carry the
 * formatting tricks, so none of it separates winners from losers.
 *
 * What is mechanical, checkable, and actually gates a feature is the structured data. Google's
 * merchant listing experiences need `name`, `image` and an `offers` block carrying a price, a
 * currency and availability. A page missing those is not competing badly, it is not eligible, and
 * that is a fact a parser can establish exactly rather than an opinion about depth.
 *
 * Near-duplicate product copy is deliberately not here: TECH-012 already finds it across the whole
 * site with simhash, and a second rule reporting the same pages would be asking a client to act
 * twice on one problem.
 */

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

function typesOf(node: JsonObject): string[] {
  const type = node['@type']
  if (typeof type === 'string') return [type]
  if (Array.isArray(type)) return type.filter((value): value is string => typeof value === 'string')
  return []
}

const isProduct = (node: JsonObject): boolean =>
  typesOf(node).some((type) => type === 'Product' || type === 'ProductGroup')

/**
 * Is this page selling one thing?
 *
 * Three signals, any of which is the page saying so itself: Product structured data, an
 * `og:type` of `product`, or an add-to-cart form from a platform whose markup is conventional.
 * Nothing here guesses from a URL containing `/product/`, because a blog post about a product
 * lives at a URL like that too, and a rule that fired on it would be reporting a missing price on
 * an article.
 */
function isProductPage(page: CrawledPage): boolean {
  if (flattenNodes(page.extract.jsonLd).some(isProduct)) return true

  const html = page.renderedHtml
  if (/property=["']og:type["'][^>]*content=["']product["']/i.test(html)) return true
  if (/content=["']product["'][^>]*property=["']og:type["']/i.test(html)) return true

  // Shopify and WooCommerce both mark the buy form in a way that is stable across themes.
  return /name=["']add-to-cart["']|action=["'][^"']*\/cart\/add/i.test(html)
}

/** The offers on a product node, whether it carried one or several. */
function offersOf(node: JsonObject): JsonObject[] {
  const offers = node['offers']
  if (Array.isArray(offers))
    return offers.filter((o): o is JsonObject => !!o && typeof o === 'object')
  if (offers && typeof offers === 'object') return [offers as JsonObject]
  return []
}

const hasText = (value: unknown): boolean =>
  (typeof value === 'string' && value.trim() !== '') ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.length > 0) ||
  (!!value && typeof value === 'object')

/**
 * PROD-001: a product page whose structured data cannot produce a merchant listing.
 *
 * Fires when the page is evidently selling something and either carries no Product node at all, or
 * carries one missing a property Google requires. The finding names the missing properties rather
 * than saying "improve your schema", because the list is the work.
 *
 * Not fixable by a diff. The missing values are facts about the product (its price today, whether
 * it is in stock) that live in a database or a CMS, not in the repository, and a fixer that wrote
 * a price into a template would be publishing a number nobody verified.
 */
export const PROD_001: Rule = {
  id: 'PROD-001',
  axis: 'structure',
  severity: 'medium',
  estimatedEffort: 'medium',
  fixable: false,
  description:
    'A product page is missing the structured data Google needs to show it as a product.',

  evaluate: (context) => {
    return indexableHtmlPages(context.pages)
      .filter(isProductPage)
      .flatMap((page) => {
        const product = flattenNodes(page.extract.jsonLd).find(isProduct)

        const missing = product
          ? [
              hasText(product['name']) ? null : 'name',
              hasText(product['image']) ? null : 'image',
              ...missingOfferFields(product),
            ].filter((field): field is string => field !== null)
          : ['the whole Product block']

        if (missing.length === 0) return []

        return [
          {
            title: product
              ? `${page.finalUrl} has Product structured data missing ${missing.join(', ')}`
              : `${page.finalUrl} sells a product but has no Product structured data`,
            evidence: markupEvidence(
              page,
              'script[type="application/ld+json"] Product',
              JSON.stringify({ missing, found: product ? typesOf(product) : [] }),
            ),
            affectedUrls: [page.finalUrl],
            confidence: product ? 1 : 0.8,
            estimatedImpact: 45,
            falsification:
              `Run ${page.finalUrl} through Google's Rich Results Test. If it reports a valid ` +
              'product with no errors, this was wrong. After the fix it should report one, and ' +
              "Search Console's merchant listings report should stop excluding the page. " +
              'Eligibility is not a placement: valid markup makes the listing possible, it does ' +
              'not promise one.',
          },
        ]
      })
  },
}

/** Which of the required offer fields are absent, named for the finding. */
function missingOfferFields(product: JsonObject): (string | null)[] {
  const offers = offersOf(product)
  if (offers.length === 0) return ['offers']

  // One complete offer is enough: a product with several variants only needs one that is
  // purchasable for the listing to be eligible.
  const complete = offers.some(
    (offer) =>
      hasText(offer['price'] ?? offer['priceSpecification']) &&
      hasText(offer['priceCurrency']) &&
      hasText(offer['availability']),
  )
  if (complete) return []

  const first = offers[0] as JsonObject
  return [
    hasText(first['price'] ?? first['priceSpecification']) ? null : 'offers.price',
    hasText(first['priceCurrency']) ? null : 'offers.priceCurrency',
    hasText(first['availability']) ? null : 'offers.availability',
  ]
}

/** Every number in a string, normalised: thousands separators dropped, decimals kept. */
function numbersIn(text: string): Set<number> {
  const found = new Set<number>()

  for (const match of text.matchAll(/\d[\d,\u00a0 ]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/[,\u00a0 ]/g, ''))
    if (Number.isFinite(value)) found.add(value)
  }

  return found
}

/**
 * PROD-002: the price in the structured data appears nowhere on the page.
 *
 * Google's merchant policies treat a price in markup that disagrees with the price a shopper sees
 * as a reason to drop the listing, and it is the kind of error that survives for months because
 * both halves look right on their own: the page shows the new price, the template still emits the
 * old one from a cached field.
 *
 * Deliberately conservative. It fires only when the marked-up number is absent from the visible
 * text entirely, not when the page happens to show other numbers too, so a page listing related
 * products at other prices is silent. The comparison is numeric, so `12500.00` matches
 * `KSh 12,500` and formatting is never mistaken for a mismatch.
 */
export const PROD_002: Rule = {
  id: 'PROD-002',
  axis: 'structure',
  severity: 'high',
  estimatedEffort: 'small',
  fixable: false,
  description: 'The price in a product page’s structured data is not shown anywhere on it.',

  evaluate: (context) => {
    return indexableHtmlPages(context.pages)
      .filter(isProductPage)
      .flatMap((page) => {
        const product = flattenNodes(page.extract.jsonLd).find(isProduct)
        if (!product) return [] // PROD-001's case, not this one

        const priced = offersOf(product)
          .map((offer) => Number(offer['price']))
          .filter((price) => Number.isFinite(price) && price > 0)

        if (priced.length === 0) return []

        const shown = numbersIn(page.extract.text)
        const absent = priced.filter((price) => !shown.has(price))

        // Any one of several variant prices appearing is enough: a variant picker legitimately
        // shows one price at a time, and only a marked-up price nobody can see is the fault.
        if (absent.length === 0 || absent.length < priced.length) return []

        return [
          {
            title: `${page.finalUrl} marks up a price of ${priced.join(', ')} that the page never shows`,
            evidence: markupEvidence(
              page,
              'script[type="application/ld+json"] Product offers.price',
              JSON.stringify({ markedUp: priced }),
            ),
            affectedUrls: [page.finalUrl],
            // A price rendered into an image, or assembled by script after our snapshot, would
            // read as absent. Rare, and worth a human glance rather than silence.
            confidence: 0.85,
            estimatedImpact: 55,
            falsification:
              `Open ${page.finalUrl} and read the price a shopper sees. If it matches the ` +
              `marked-up ${priced.join(', ')}, this was wrong, most likely because the price is ` +
              'drawn as an image or written by script after the page loads. Otherwise correct ' +
              'whichever is stale; a re-crawl then finds the marked-up price in the page text.',
          },
        ]
      })
  },
}
