import { indexableHtmlPages, markupEvidence, metricEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

/**
 * TECH-015: mixed content. An HTTPS page loads a subresource over plain HTTP.
 *
 * Browsers block this outright, so the page silently loses functionality. The author
 * rarely notices, because their own browser has the resource cached from development.
 */
export const TECH_015: Rule = {
  id: 'TECH-015',
  axis: 'crawl_health',
  severity: 'high',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'An HTTPS page loads a script, stylesheet or image over insecure HTTP.',

  evaluate: (context) =>
    context.pages
      .filter((page) => page.finalUrl.startsWith('https://'))
      .flatMap((page) => {
        const insecure = page.extract.resources.filter((resource) =>
          (resource.resolved ?? resource.url).startsWith('http://'),
        )

        if (insecure.length === 0) return []

        return [
          {
            title: `${page.finalUrl} loads ${insecure.length} resource(s) over insecure HTTP`,
            evidence: markupEvidence(
              page,
              insecure.map((r) => r.type).join(', '),
              insecure.map((r) => r.resolved ?? r.url).join('\n'),
            ),
            affectedUrls: [page.finalUrl],
            confidence: 1,
            estimatedImpact: 60,
            falsification:
              `Load ${page.finalUrl} and check the browser console for mixed content warnings. ` +
              'If every subresource is https, this was wrong. After the fix, the console should ' +
              'be clean and every resource URL should begin with https.',
          },
        ]
      }),
}

/**
 * TECH-016: hreflang without a return tag.
 *
 * hreflang only works if it is reciprocal. If page A says "the Swahili version is B" but
 * B does not say "the English version is A", Google ignores the whole cluster. The
 * annotation looks correct, does nothing, and nobody finds out.
 *
 * Only checks pages we actually crawled. A missing return tag on a page we never fetched
 * is not evidence of anything.
 */
export const TECH_016: Rule = {
  id: 'TECH-016',
  axis: 'crawl_health',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: true,
  description: 'An hreflang annotation is not reciprocated by the page it points at.',

  evaluate: (context) => {
    const byUrl = new Map(context.pages.map((page) => [page.finalUrl, page]))

    return context.pages.flatMap((page) => {
      const missing = page.extract.hreflang.filter((alternate) => {
        if (alternate.hreflang === 'x-default') return false
        if (alternate.href === page.finalUrl) return false

        const target = byUrl.get(alternate.href)
        if (!target) return false // never crawled, so we know nothing

        return !target.extract.hreflang.some((back) => back.href === page.finalUrl)
      })

      if (missing.length === 0) return []

      return [
        {
          title: `${page.finalUrl} declares hreflang alternates that do not link back`,
          evidence: markupEvidence(
            page,
            'link[rel="alternate"][hreflang]',
            missing.map((m) => `${m.hreflang} -> ${m.href} (no return tag)`).join('\n'),
          ),
          affectedUrls: [page.finalUrl, ...missing.map((m) => m.href)],
          confidence: 1,
          estimatedImpact: 40,
          falsification:
            'Fetch each named alternate and look for an hreflang link back to this page. If ' +
            "every one reciprocates, this was wrong. After the fix, Search Console's " +
            'International Targeting report should stop reporting "no return tags".',
        },
      ]
    })
  },
}

/**
 * TECH-017: a soft 404. The page says "not found" but returns 200.
 *
 * Google indexes it as a real page, and the user lands on nothing. Requires BOTH a
 * not-found phrase in the title or h1 AND a thin body: a blog post titled "How to design a
 * good 404 page" is a real article and must not be flagged. That is the false positive
 * this rule is built to avoid.
 */
const SOFT_404_PHRASES = /^\s*(404|page not found|not found|page doesn'?t exist|no results)/i
const SOFT_404_MAX_WORDS = 150

export const TECH_017: Rule = {
  id: 'TECH-017',
  axis: 'crawl_health',
  severity: 'high',
  estimatedEffort: 'small',
  fixable: false,
  description: 'A page says "not found" but returns HTTP 200, so Google indexes it.',

  evaluate: (context) =>
    context.pages
      .filter((page) => {
        if (page.status !== 200) return false

        const title = page.extract.title ?? ''
        const h1 = page.extract.h1s[0] ?? ''
        const saysNotFound = SOFT_404_PHRASES.test(title) || SOFT_404_PHRASES.test(h1)

        return saysNotFound && page.extract.wordCount < SOFT_404_MAX_WORDS
      })
      .map((page) => ({
        title: `${page.finalUrl} looks like a 404 page but returns HTTP 200`,
        evidence: metricEvidence(page, 'http_status_on_not_found_page', page.status, 'count'),
        affectedUrls: [page.finalUrl],
        confidence: 0.85,
        estimatedImpact: 55,
        falsification:
          `Open ${page.finalUrl}. If it is a real page with real content, this was wrong and ` +
          'the phrase match is too eager. After the fix, the URL should return 404 or 410, ' +
          'and Search Console should reclassify it from "Soft 404" to "Not found".',
      })),
}

/**
 * TECH-018: the page is empty until JavaScript runs.
 *
 * Google does render JavaScript, so this is not fatal, and the finding says so. But
 * rendering is slower, it is queued separately, and it fails more often than people
 * expect. Claiming "Google cannot see your page" would be false, and the honest version
 * is more useful anyway.
 */
export const TECH_018: Rule = {
  id: 'TECH-018',
  axis: 'crawl_health',
  severity: 'medium',
  estimatedEffort: 'large',
  fixable: false,
  description: 'The server sends an empty shell; the page only exists after JavaScript runs.',

  evaluate: (context) =>
    context.pages
      .filter((page) => page.status === 200 && page.render.likelyCsrOnly)
      .map((page) => ({
        title: `${page.finalUrl} renders nothing until JavaScript runs`,
        evidence: metricEvidence(
          page,
          'pre_js_content_ratio',
          Number(page.render.ratio.toFixed(3)),
          'ratio',
        ),
        affectedUrls: [page.finalUrl],
        confidence: 0.9,
        estimatedImpact: 50,
        falsification:
          `Fetch ${page.finalUrl} with JavaScript disabled. If the main content is present in ` +
          'the HTML, this was wrong. After the fix, the server response should already contain ' +
          'the h1 and the body copy. Be honest with the user: Google DOES render JavaScript, ' +
          'so this is a risk and a speed penalty, not an invisibility cloak. If rankings do ' +
          'not move after server-rendering, the cause was something else.',
      })),
}

/** TECH-019: a page with no h1, or with more than one. */
export const TECH_019: Rule = {
  id: 'TECH-019',
  axis: 'content',
  severity: 'low',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'A page has no h1, or has several.',

  evaluate: (context) =>
    indexableHtmlPages(context.pages)
      .filter((page) => page.extract.h1s.length !== 1)
      .map((page) => {
        const count = page.extract.h1s.length

        return {
          title:
            count === 0
              ? `${page.finalUrl} has no h1`
              : `${page.finalUrl} has ${count} h1 headings`,
          evidence: markupEvidence(page, 'h1', page.extract.h1s.join(' | ')),
          affectedUrls: [page.finalUrl],
          confidence: 1,
          // Honest impact. Multiple h1s are valid HTML5 and Google has said repeatedly
          // that they are not a problem. This is a clarity and accessibility issue far
          // more than a ranking one, and the score says so.
          estimatedImpact: 15,
          falsification:
            `Re-crawl ${page.finalUrl} and count h1 elements. If there is exactly one, this ` +
            'was wrong. Do not expect a ranking movement from this alone: multiple h1s are ' +
            'valid HTML5 and Google has said they do not cause a problem. Fix it for clarity ' +
            'and for screen readers, not for rank.',
        }
      }),
}

/** TECH-020: the heading hierarchy skips a level, e.g. h2 straight to h4. */
export const TECH_020: Rule = {
  id: 'TECH-020',
  axis: 'content',
  severity: 'info',
  estimatedEffort: 'trivial',
  fixable: true,
  description: 'The heading hierarchy skips a level.',

  evaluate: (context) =>
    indexableHtmlPages(context.pages).flatMap((page) => {
      const levels = page.extract.headings.map((heading) => heading.level)

      const skips = levels.flatMap((level, index) => {
        if (index === 0) return []
        const previous = levels[index - 1] as number
        return level > previous + 1 ? [`h${previous} -> h${level}`] : []
      })

      if (skips.length === 0) return []

      return [
        {
          title: `${page.finalUrl} skips a heading level (${skips.join(', ')})`,
          evidence: markupEvidence(
            page,
            'h1, h2, h3, h4, h5, h6',
            page.extract.headings.map((h) => `h${h.level}: ${h.text}`).join('\n'),
          ),
          affectedUrls: [page.finalUrl],
          confidence: 1,
          // Severity: info. This is an accessibility nicety. Anyone selling it as a
          // ranking factor is selling something.
          estimatedImpact: 5,
          falsification:
            `Re-crawl ${page.finalUrl} and walk the heading levels in document order. If no ` +
            'level is skipped, this was wrong. Expect no ranking change whatsoever from ' +
            'fixing this. It is for screen reader users, and that is reason enough.',
        },
      ]
    }),
}
