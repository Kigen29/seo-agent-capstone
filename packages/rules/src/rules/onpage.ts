import { normaliseUrl, type CrawledPage } from '@seo/crawler'
import { indexableHtmlPages, markupEvidence, metricEvidence } from '../evidence.js'
import type { FindingDraft, Rule, RuleContext } from '../types.js'

/**
 * The page-level basics: titles, descriptions, link text, thin pages, and URLs.
 *
 * These are the checks a marketer learns first and expects to see in any audit, and the product
 * had almost none of them: it was strong on crawling and indexing and silent on what is written in
 * the head of each page.
 *
 * Every rule here raises ONE finding for the site, listing the pages, not one finding per page.
 * A site with forty pages and no descriptions has one problem with one fix (write them), and forty
 * rows in the inbox would bury the three findings that can actually take the site out of Google.
 * TECH-021 made the same call when it limited itself to the homepage.
 *
 * None of these is presented as a ranking factor it is not. A title cut off in the results costs
 * clicks, not position; Google has said word count is not a ranking factor, so a thin page is
 * reported as saying very little, never as missing a word target; and keyword density, which the
 * same courses teach, is deliberately absent because it does not separate pages that rank from
 * pages that do not.
 */

const homeOf = (context: RuleContext): string => normaliseUrl(context.seed) ?? context.seed

const isHome = (context: RuleContext, page: CrawledPage): boolean =>
  (normaliseUrl(page.finalUrl) ?? page.finalUrl) === homeOf(context)

/** The first page as evidence, the rest as affected URLs. */
const grouped = (
  pages: readonly CrawledPage[],
  draft: Omit<FindingDraft, 'affectedUrls'>,
): FindingDraft[] =>
  pages.length === 0 ? [] : [{ ...draft, affectedUrls: pages.map((page) => page.finalUrl) }]

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** TECH-024: an indexable page has no title, so Google invents one. */
export const TECH_024: Rule = {
  id: 'TECH-024',
  axis: 'content',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: false,
  description: 'A page has no title tag, so Google makes up the headline shown in search results.',

  evaluate: (context) => {
    const missing = indexableHtmlPages(context.pages).filter(
      (page) => (page.extract.title ?? '').trim().length === 0,
    )
    if (missing.length === 0) return []
    return grouped(missing, {
      title: `${plural(missing.length, 'page has', 'pages have')} no title tag`,
      subject: 'missing-title',
      evidence: markupEvidence(missing[0]!, 'title', ''),
      confidence: 1,
      estimatedImpact: 45,
      falsification:
        `Re-fetch ${missing[0]?.finalUrl} and read the title element in the rendered head. If it ` +
        'is present and not empty, this was wrong. After the fix, Search Console should show the ' +
        'page under its own title rather than one Google wrote from the page text.',
    })
  },
}

/**
 * Titles longer than this are usually cut off in desktop results.
 *
 * Google truncates by pixel width, not by character count, so this is an estimate: about 60
 * characters fits the result column for most text. It is the figure every SEO course teaches, and
 * it is reported here as "likely to be cut off", never as a limit Google enforces.
 */
export const TITLE_DISPLAY_CHARS = 60

/** TECH-025: titles too long to show in full. */
export const TECH_025: Rule = {
  id: 'TECH-025',
  axis: 'content',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: false,
  description: 'A title is long enough that search results will probably cut it off.',

  evaluate: (context) => {
    const long = indexableHtmlPages(context.pages).filter(
      (page) => (page.extract.title ?? '').trim().length > TITLE_DISPLAY_CHARS,
    )
    if (long.length === 0) return []
    const longest = [...long].sort(
      (a, b) => (b.extract.title ?? '').length - (a.extract.title ?? '').length,
    )[0]
    return grouped(long, {
      title: `${plural(long.length, 'title is', 'titles are')} likely to be cut off in search results`,
      subject: 'long-title',
      evidence: longest
        ? metricEvidence(
            longest,
            'title_length',
            (longest.extract.title ?? '').trim().length,
            'count',
          )
        : markupEvidence(long[0]!, 'title', ''),
      confidence: 0.7,
      estimatedImpact: 15,
      falsification:
        `Search Google for a query that returns ${longest?.finalUrl} and look at its headline. If ` +
        'it is shown in full, this was wrong for that page: Google cuts titles by width, and ' +
        `${TITLE_DISPLAY_CHARS} characters is an estimate. This affects clicks, not position.`,
    })
  },
}

/** TECH-026: pages other than the homepage with no meta description. TECH-021 covers the homepage. */
export const TECH_026: Rule = {
  id: 'TECH-026',
  axis: 'content',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: false,
  description: 'Pages have no meta description, so Google writes each search snippet itself.',

  evaluate: (context) => {
    const missing = indexableHtmlPages(context.pages).filter(
      (page) => !isHome(context, page) && (page.extract.metaDescription ?? '').trim().length === 0,
    )
    if (missing.length === 0) return []
    return grouped(missing, {
      title: `${plural(missing.length, 'page has', 'pages have')} no meta description`,
      subject: 'missing-description',
      evidence: markupEvidence(missing[0]!, 'meta[name="description"]', ''),
      confidence: 1,
      estimatedImpact: 20,
      falsification:
        `Re-fetch ${missing[0]?.finalUrl} and read meta[name="description"]. If it carries a ` +
        'non-empty description, this was wrong. A description is not a ranking factor and Google ' +
        'still rewrites snippets per query, so expect a clickthrough change at most.',
    })
  },
}

/** TECH-027: several pages share one meta description, so their snippets cannot tell them apart. */
export const TECH_027: Rule = {
  id: 'TECH-027',
  axis: 'content',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: false,
  description: 'Several pages share the same meta description.',

  evaluate: (context) => {
    const byDescription = new Map<string, CrawledPage[]>()
    for (const page of indexableHtmlPages(context.pages)) {
      const description = (page.extract.metaDescription ?? '').trim()
      if (description.length === 0) continue
      byDescription.set(description, [...(byDescription.get(description) ?? []), page])
    }

    return [...byDescription.entries()]
      .filter(([, pages]) => pages.length > 1)
      .map(([description, pages]) => ({
        title: `${pages.length} pages share one meta description`,
        // About the description, whichever pages currently carry it.
        subject: description,
        evidence: markupEvidence(pages[0]!, 'meta[name="description"]', description.slice(0, 200)),
        affectedUrls: pages.map((page) => page.finalUrl),
        confidence: 1,
        estimatedImpact: 20,
        falsification:
          `Re-fetch ${pages[0]!.finalUrl} and ${pages[1]!.finalUrl} and compare their ` +
          'meta descriptions. If they differ, this was wrong.',
      }))
  },
}

/**
 * Link text that says nothing about where the link goes.
 *
 * Google's own guidance is to write descriptive link text, because the text is how a reader and a
 * crawler learn what the target is about. Empty link text is deliberately not counted: a linked
 * logo has no text of its own, and whether its image has alt text is another rule's question.
 */
const GENERIC_ANCHORS = new Set([
  'here',
  'click here',
  'click',
  'read more',
  'learn more',
  'more',
  'more info',
  'more information',
  'this',
  'this page',
  'link',
  'website',
  'go',
  'see more',
  'view more',
  'details',
])

const isGeneric = (text: string): boolean =>
  GENERIC_ANCHORS.has(
    text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[»›→>.!:]+$/u, '')
      .trim(),
  )

/** TECH-028: internal links whose text is "click here" or "read more". */
export const TECH_028: Rule = {
  id: 'TECH-028',
  axis: 'structure',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: false,
  description: 'Internal links use text like "click here", which says nothing about the target.',

  evaluate: (context) => {
    const offenders: { page: CrawledPage; texts: string[] }[] = []
    for (const page of indexableHtmlPages(context.pages)) {
      const texts = page.extract.links
        .filter((link) => link.internal && isGeneric(link.anchorText))
        .map((link) => link.anchorText.trim())
      if (texts.length > 0) offenders.push({ page, texts })
    }
    if (offenders.length === 0) return []
    const total = offenders.reduce((sum, entry) => sum + entry.texts.length, 0)
    const first = offenders[0]

    return grouped(
      offenders.map((entry) => entry.page),
      {
        title: `${plural(total, 'internal link uses', 'internal links use')} text like "${first?.texts[0]}"`,
        subject: 'generic-anchor-text',
        evidence: first
          ? markupEvidence(first.page, 'a', first.texts.slice(0, 5).join(' | '))
          : markupEvidence(context.pages[0]!, 'a', ''),
        confidence: 0.9,
        estimatedImpact: 20,
        falsification:
          `Re-fetch ${first?.page.finalUrl} and read the text of its internal links. If none is a ` +
          'generic phrase such as "click here" or "read more", this was wrong. A card whose whole ' +
          'heading is also linked may make one "read more" harmless; judge those by eye.',
      },
    )
  },
}

/** Below this many words, a page that is meant to be found says very little. */
export const THIN_PAGE_WORDS = 100

/**
 * Pages that are short on purpose. A contact page or a login form is not thin content, and
 * flagging them teaches people to ignore the rule.
 */
const UTILITY_PATH =
  /\/(contact|contact-us|login|log-in|signin|sign-in|signup|sign-up|register|cart|basket|checkout|account|search|thank-you|thanks|privacy|terms|cookies?)(\/|$)/i

const looksLikeNotFound = (page: CrawledPage): boolean =>
  /\b(404|not found)\b/i.test(`${page.extract.title ?? ''} ${page.extract.h1s[0] ?? ''}`)

/** TECH-029: indexable pages with almost nothing on them. */
export const TECH_029: Rule = {
  id: 'TECH-029',
  axis: 'content',
  severity: 'medium',
  estimatedEffort: 'medium',
  fixable: false,
  description: 'Pages meant to be found in search have almost no text on them.',

  evaluate: (context) => {
    const thin = indexableHtmlPages(context.pages).filter((page) => {
      if (page.extract.wordCount >= THIN_PAGE_WORDS) return false
      // A soft 404 is TECH-017's finding, and a shell that never rendered is TECH-018's.
      if (looksLikeNotFound(page) || page.extract.wordCount === 0) return false
      try {
        return !UTILITY_PATH.test(new URL(page.finalUrl).pathname)
      } catch {
        return false
      }
    })
    if (thin.length === 0) return []
    const thinnest = [...thin].sort((a, b) => a.extract.wordCount - b.extract.wordCount)[0]

    return grouped(thin, {
      title: `${plural(thin.length, 'page says', 'pages say')} very little (under ${THIN_PAGE_WORDS} words)`,
      subject: 'thin-pages',
      evidence: thinnest
        ? metricEvidence(thinnest, 'word_count', thinnest.extract.wordCount, 'count')
        : markupEvidence(thin[0]!, 'body', ''),
      confidence: 0.8,
      estimatedImpact: 35,
      falsification:
        `Open ${thinnest?.finalUrl} and read it as a visitor. If it fully answers what someone ` +
        'arriving from search would want, this was wrong for that page: word count is not a ' +
        'ranking factor, and a short page that answers the question is fine. The count is from ' +
        'the rendered page, so text that only appears after a click is not included.',
    })
  },
}

/** TECH-030: URL paths with spaces, underscores or capital letters. */
export const TECH_030: Rule = {
  id: 'TECH-030',
  axis: 'structure',
  severity: 'info',
  estimatedEffort: 'medium',
  fixable: false,
  description: 'Page addresses contain spaces, underscores or capital letters.',

  evaluate: (context) => {
    const awkward = indexableHtmlPages(context.pages).filter((page) => {
      try {
        const path = decodeURIComponent(new URL(page.finalUrl).pathname)
        return /[\s_]/.test(path) || /[A-Z]/.test(path)
      } catch {
        return false
      }
    })
    if (awkward.length === 0) return []
    return grouped(awkward, {
      title: `${plural(awkward.length, 'page address contains', 'page addresses contain')} spaces, underscores or capital letters`,
      subject: 'url-hygiene',
      evidence: markupEvidence(awkward[0]!, 'location', awkward[0]?.finalUrl ?? ''),
      confidence: 1,
      estimatedImpact: 5,
      falsification:
        `Look at the path of ${awkward[0]?.finalUrl}. If it has no space (shown as %20), no ` +
        'underscore and no capital letter, this was wrong. Google recommends hyphens between words, and addresses are ' +
        'case-sensitive, so mixed case invites duplicates. Changing a live address needs a ' +
        'redirect from the old one, which is why this is information, not an instruction.',
    })
  },
}

/**
 * TECH-031: links to other sites that no longer go anywhere.
 *
 * Only links the crawl established are gone: the server answered 404 or 410, or the domain no
 * longer resolves. A site that refused the crawler, errored, or timed out is not reported, because
 * most of those links work in a browser and "fix" would mean deleting a good citation.
 */
export const TECH_031: Rule = {
  id: 'TECH-031',
  axis: 'structure',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: false,
  description: 'Links to other websites point at pages that no longer exist.',

  evaluate: (context) => {
    const broken = (context.outbound ?? []).filter((link) => link.outcome === 'broken')
    if (broken.length === 0) return []

    const carriers = new Set(broken.flatMap((link) => link.linkedFrom))
    const pages = indexableHtmlPages(context.pages).filter((page) => carriers.has(page.finalUrl))
    const first = pages[0] ?? context.pages[0]
    if (!first) return []

    const describe = (link: (typeof broken)[number]): string =>
      `${link.url} (${link.status ?? 'domain does not resolve'})`

    return [
      {
        title: `${plural(broken.length, 'link to another site is', 'links to other sites are')} dead`,
        subject: 'broken-outbound-links',
        evidence: markupEvidence(first, 'a[href]', broken.slice(0, 5).map(describe).join(' | ')),
        affectedUrls: pages.length > 0 ? pages.map((page) => page.finalUrl) : [first.finalUrl],
        // A 404 from a crawler is occasionally a refusal in disguise, so not quite certain.
        confidence: 0.9,
        estimatedImpact: 15,
        falsification:
          `Open ${broken[0]!.url} in a browser. If the page loads, this was wrong for that link: ` +
          'some servers answer a crawler with 404 while serving people. After the fix, each ' +
          'listed link either points at a page that loads or has been removed.',
      },
    ]
  },
}

/**
 * TECH-032: pages with no responsive viewport tag.
 *
 * Without `width=device-width` a phone lays the page out as if it were a desktop screen and
 * shrinks the result, so the text is too small to read without zooming. Google indexes the mobile
 * version of a page, so this is the version being judged.
 */
export const TECH_032: Rule = {
  id: 'TECH-032',
  axis: 'structure',
  severity: 'medium',
  estimatedEffort: 'trivial',
  fixable: false,
  description: 'Pages are not set up to fit a phone screen: the viewport tag is missing or fixed.',

  evaluate: (context) => {
    const unfit = indexableHtmlPages(context.pages).filter(
      (page) => !/width\s*=\s*device-width/i.test(page.extract.viewport ?? ''),
    )
    if (unfit.length === 0) return []
    return grouped(unfit, {
      title: `${plural(unfit.length, 'page is', 'pages are')} not set up to fit a phone screen`,
      subject: 'missing-viewport',
      evidence: markupEvidence(
        unfit[0]!,
        'meta[name="viewport"]',
        unfit[0]!.extract.viewport ?? '',
      ),
      confidence: 1,
      estimatedImpact: 40,
      falsification:
        `Re-fetch ${unfit[0]!.finalUrl} and read meta[name="viewport"]. If its content includes ` +
        'width=device-width, this was wrong. After the fix, the page opens on a phone at a ' +
        'readable size without zooming.',
    })
  },
}

/** A few pixels of overflow is a rounding artefact or a scrollbar, not a layout problem. */
export const MOBILE_OVERFLOW_TOLERANCE_PX = 8

/** TECH-033: pages that are wider than a phone screen when actually rendered on one. */
export const TECH_033: Rule = {
  id: 'TECH-033',
  axis: 'structure',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: false,
  description: 'Pages are wider than a phone screen, so visitors have to scroll sideways.',

  evaluate: (context) => {
    const wide = (context.mobile ?? []).filter(
      (render) => render.overflowPx > MOBILE_OVERFLOW_TOLERANCE_PX,
    )
    if (wide.length === 0) return []

    const worst = [...wide].sort((a, b) => b.overflowPx - a.overflowPx)[0]!
    const page = context.pages.find((candidate) => candidate.finalUrl === worst.url)
    if (!page) return []
    const checked = context.mobile?.length ?? 0

    return [
      {
        title: `${wide.length} of ${checked} pages checked on a phone-sized screen scroll sideways`,
        subject: 'mobile-overflow',
        evidence: metricEvidence(page, 'mobile_overflow_px', worst.overflowPx, 'count'),
        affectedUrls: wide.map((render) => render.url),
        confidence: 0.9,
        estimatedImpact: 40,
        falsification:
          `Open ${worst.url} on a phone, or in a browser window ${worst.viewportWidth} pixels ` +
          'wide. If the page cannot be scrolled sideways, this was wrong. Only a sample of ' +
          'pages is rendered this way, so other pages using the same template are likely affected.',
      },
    ]
  },
}

/**
 * An image heavier than this is nearly always larger than it needs to be for a web page.
 *
 * Not a standard: there is none. 300 KB is where a photograph at the size a page displays it,
 * saved in a modern format, comfortably fits, so anything above it is worth a look.
 */
export const HEAVY_IMAGE_BYTES = 300 * 1024

const megabytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`

/** Formats that predate WebP and AVIF. A heavy image in one of these has the cheapest fix. */
const LEGACY_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp'])

/**
 * TECH-034: images much heavier than a web page needs.
 *
 * On the content axis, not performance, on purpose. Performance here is scored only from real
 * visitors' Core Web Vitals, and a heavy image is not evidence that those are poor: this is a fact
 * about the files, offered as a likely cause when the field data does say the site is slow, and
 * never as a reason to change a site real users already find fast.
 */
export const TECH_034: Rule = {
  id: 'TECH-034',
  axis: 'content',
  severity: 'low',
  estimatedEffort: 'small',
  fixable: false,
  description: 'Images are much heavier than a web page needs, which slows the page for visitors.',

  evaluate: (context) => {
    const heavy = (context.images ?? [])
      .filter((image) => image.bytes !== null && image.bytes >= HEAVY_IMAGE_BYTES)
      .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
    if (heavy.length === 0) return []

    const heaviest = heavy[0]!
    const users = new Set(heavy.flatMap((image) => image.usedOn))
    const pages = context.pages.filter((page) => users.has(page.finalUrl))
    const first = pages.find((page) => heaviest.usedOn.includes(page.finalUrl)) ?? pages[0]
    if (!first) return []

    const total = heavy.reduce((sum, image) => sum + (image.bytes ?? 0), 0)
    const legacy = heavy.filter((image) => LEGACY_IMAGE_TYPES.has(image.contentType ?? '')).length

    return [
      {
        title:
          `${plural(heavy.length, 'image is', 'images are')} heavier than ` +
          `${megabytes(HEAVY_IMAGE_BYTES)} (largest ${megabytes(heaviest.bytes!)}, ${megabytes(total)} in all)`,
        subject: 'heavy-images',
        evidence: metricEvidence(first, 'largest_image_bytes', heaviest.bytes!, 'count'),
        affectedUrls: pages.map((page) => page.finalUrl),
        confidence: 0.9,
        estimatedImpact: 30,
        falsification:
          `Request ${heaviest.url} and read its Content-Length. If it is under ` +
          `${megabytes(HEAVY_IMAGE_BYTES)}, this was wrong for that image. ` +
          (legacy > 0
            ? `${legacy} of these ${legacy === 1 ? 'is a' : 'are'} JPEG, PNG or GIF, where ` +
              'saving as WebP or AVIF at the size the page displays is usually most of the saving. '
            : '') +
          'Whether this makes the site slow for real visitors is answered by the Core Web ' +
          'Vitals field data, not by file sizes: if that data is good, this is not urgent.',
      },
    ]
  },
}
