import * as cheerio from 'cheerio'
import type {
  Heading,
  Hreflang,
  MetaRobots,
  PageExtract,
  PageImage,
  PageLink,
  PageResource,
} from './types.js'

/**
 * Everything we can learn from a page's HTML, as a pure function.
 *
 * Deliberately takes an HTML string rather than a live Playwright page, for three
 * reasons: it is testable against fixtures with no browser, it can be run over the
 * pre-JS HTML and the post-JS DOM with identical code (which is how we detect a
 * client-side-rendered page), and it is deterministic, which ADR-0001 requires of
 * anything that feeds a rule.
 */

/** Schemes that are not pages and must never enter the crawl frontier. */
const NON_PAGE_SCHEMES = /^(mailto:|tel:|javascript:|data:|sms:|blob:|#)/i

function resolve(href: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(href, baseUrl)
    // The fragment is never sent to the server, so /a and /a#x are one page.
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function isInternal(resolved: string | undefined, baseUrl: string): boolean {
  if (!resolved) return false
  try {
    return new URL(resolved).host === new URL(baseUrl).host
  } catch {
    return false
  }
}

function numeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseMetaRobots(raw: string | null): MetaRobots {
  const directives = (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)

  return {
    raw,
    directives,
    // Absent robots meta means indexable. The default is permissive, and assuming
    // otherwise would report half the web as noindexed.
    index: !directives.includes('noindex') && !directives.includes('none'),
    follow: !directives.includes('nofollow') && !directives.includes('none'),
  }
}

export function extractPage(html: string, baseUrl: string): PageExtract {
  const $ = cheerio.load(html)

  const title = $('head > title').first().text().trim() || null

  const metaDescription = $('meta[name="description"]').first().attr('content')?.trim() ?? null

  const canonicalHref = $('link[rel="canonical"]').first().attr('href')
  const canonical = canonicalHref ? (resolve(canonicalHref, baseUrl) ?? null) : null

  const metaRobots = parseMetaRobots(
    $('meta[name="robots"]').first().attr('content')?.trim() ?? null,
  )

  const headings: Heading[] = $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: $(el).text().trim(),
    }))

  const links: PageLink[] = $('a[href]')
    .toArray()
    .flatMap((el) => {
      const href = $(el).attr('href')?.trim()
      if (!href || NON_PAGE_SCHEMES.test(href)) return []

      const resolved = resolve(href, baseUrl)
      const rel = ($(el).attr('rel') ?? '')
        .split(/\s+/)
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean)

      return [
        {
          href,
          resolved,
          anchorText: $(el).text().trim(),
          rel,
          nofollow: rel.includes('nofollow'),
          internal: isInternal(resolved, baseUrl),
        },
      ]
    })

  const images: PageImage[] = $('img')
    .toArray()
    .flatMap((el) => {
      const src = $(el).attr('src')?.trim()
      if (!src) return []

      const alt = $(el).attr('alt')

      return [
        {
          src,
          resolved: resolve(src, baseUrl),
          // Preserve the absent/empty distinction. See the note on PageImage.alt.
          alt: alt === undefined ? null : alt,
          width: numeric($(el).attr('width')),
          height: numeric($(el).attr('height')),
          loading: $(el).attr('loading'),
          fetchPriority: $(el).attr('fetchpriority'),
        },
      ]
    })

  const jsonLd: unknown[] = []
  const jsonLdErrors: string[] = []

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).text().trim()
    if (!raw) continue

    try {
      jsonLd.push(JSON.parse(raw))
    } catch (err) {
      // Google silently ignores malformed JSON-LD, so the author thinks they have
      // structured data and they do not. Recording the error is the whole point.
      jsonLdErrors.push(err instanceof Error ? err.message : String(err))
    }
  }

  const hreflang: Hreflang[] = $('link[rel="alternate"][hreflang]')
    .toArray()
    .flatMap((el) => {
      const lang = $(el).attr('hreflang')?.trim()
      const href = $(el).attr('href')?.trim()
      if (!lang || !href) return []

      return [{ hreflang: lang, href: resolve(href, baseUrl) ?? href }]
    })

  /**
   * Subresources, collected before we strip the script tags below. An HTTPS page that
   * pulls a script over plain HTTP is mixed content: the browser blocks it outright, so
   * the page silently loses functionality its author never sees, because their own
   * browser has it cached.
   */
  const linked: { type: PageResource['type']; url: string }[] = [
    ...$('script[src]')
      .toArray()
      .map((el) => ({ type: 'script' as const, url: $(el).attr('src') ?? '' })),
    ...$('link[rel="stylesheet"][href]')
      .toArray()
      .map((el) => ({ type: 'stylesheet' as const, url: $(el).attr('href') ?? '' })),
    ...$('iframe[src]')
      .toArray()
      .map((el) => ({ type: 'iframe' as const, url: $(el).attr('src') ?? '' })),
  ]

  const resources: PageResource[] = [
    ...linked
      .filter((resource) => resource.url.trim().length > 0)
      .map((resource) => ({ ...resource, resolved: resolve(resource.url, baseUrl) })),
    // Images already carry a resolved URL from above. Reuse it rather than resolving a
    // second time, so the two answers cannot drift apart.
    ...images.map((image) => ({
      type: 'image' as const,
      url: image.src,
      resolved: image.resolved,
    })),
  ]

  // Script and style content is not page text. Counting it would inflate the word
  // count of every page with an inline analytics blob and hide genuinely thin content.
  $('script, style, noscript, template').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  const wordCount = text ? text.split(/\s+/).length : 0

  return {
    title,
    metaDescription,
    canonical,
    metaRobots,
    headings,
    h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
    links,
    images,
    jsonLd,
    jsonLdErrors,
    hreflang,
    resources,
    text,
    wordCount,
  }
}
