import { XMLParser, XMLValidator } from 'fast-xml-parser'

/**
 * Sitemap and sitemap-index parsing, per the sitemaps.org protocol.
 *
 * Forgiving, for the same reason the robots parser is: a sitemap that fails to parse
 * must be reported as "we could not read your sitemap", never as "your sitemap is
 * empty" or "your pages are missing". Those are different findings with different fixes.
 */

/** Protocol limits. Exceeding either is itself a finding: the file will be ignored. */
export const MAX_URLS_PER_SITEMAP = 50_000
export const MAX_SITEMAP_BYTES = 50 * 1024 * 1024

export interface SitemapUrl {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: number
}

export type Sitemap =
  | { kind: 'urlset'; urls: SitemapUrl[]; oversized: boolean }
  | { kind: 'index'; sitemaps: string[] }
  | { kind: 'unparseable'; reason: string }

const parser = new XMLParser({
  ignoreAttributes: true,
  // <ns:urlset> and <urlset> are the same document. Namespace prefixes are noise.
  removeNSPrefix: true,
  trimValues: true,
  // Keep everything as a string. A <priority> of 0.5 and a <lastmod> of 2026-07-13
  // must not be coerced into a number and a Date by a parser guessing at intent.
  parseTagValue: false,
})

/** A single element and a list of one element look identical in XML. Normalise both. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  // <loc><![CDATA[...]]></loc> and <loc attr="x">...</loc> both nest the text.
  if (value && typeof value === 'object' && '#text' in value) {
    const text = (value as { '#text': unknown })['#text']
    return typeof text === 'string' ? text.trim() || undefined : undefined
  }
  return undefined
}

function toUrl(entry: unknown): SitemapUrl | undefined {
  if (!entry || typeof entry !== 'object') return undefined

  const record = entry as Record<string, unknown>
  const loc = textOf(record.loc)
  if (!loc) return undefined // an entry with no location is not a URL

  const priority = textOf(record.priority)
  const parsed = priority === undefined ? undefined : Number(priority)

  return {
    loc,
    lastmod: textOf(record.lastmod),
    changefreq: textOf(record.changefreq),
    priority: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
  }
}

/** An empty element parses to '' rather than an object, so presence is the real test. */
function childrenOf(doc: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = doc[key]
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function parseSitemap(xml: string): Sitemap {
  if (!xml.trim()) return { kind: 'unparseable', reason: 'The sitemap was empty.' }

  /**
   * Validate before parsing. fast-xml-parser is lenient by default and will happily
   * return a plausible-looking object from truncated XML, which would let us report a
   * broken sitemap as a working one. Validate first, so malformed is malformed.
   */
  const valid = XMLValidator.validate(xml)
  if (valid !== true) {
    return {
      kind: 'unparseable',
      reason: `The sitemap is not valid XML: ${valid.err.msg} (line ${valid.err.line}).`,
    }
  }

  let doc: Record<string, unknown>
  try {
    doc = parser.parse(xml) as Record<string, unknown>
  } catch (err) {
    return { kind: 'unparseable', reason: `The sitemap could not be parsed: ${String(err)}` }
  }

  // A sitemap index points at other sitemaps. Check it first: an index is also a valid
  // document to hand to a crawler, and mistaking one for an empty urlset would report a
  // site with a perfectly good sitemap as having no URLs at all.
  if ('sitemapindex' in doc) {
    const sitemaps = asArray(childrenOf(doc, 'sitemapindex').sitemap)
      .map((entry) => toUrl(entry)?.loc)
      .filter((loc): loc is string => Boolean(loc))

    return { kind: 'index', sitemaps }
  }

  if ('urlset' in doc) {
    const urls = asArray(childrenOf(doc, 'urlset').url)
      .map(toUrl)
      .filter((url): url is SitemapUrl => url !== undefined)

    return {
      kind: 'urlset',
      urls: urls.slice(0, MAX_URLS_PER_SITEMAP),
      oversized: urls.length > MAX_URLS_PER_SITEMAP,
    }
  }

  return {
    kind: 'unparseable',
    reason: 'The XML has no <urlset> or <sitemapindex> root, so it is not a sitemap.',
  }
}
