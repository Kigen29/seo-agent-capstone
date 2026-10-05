import type { BrowserContext } from 'playwright'
import type { CrawledPage } from './types.js'

/**
 * Does the page fit a phone?
 *
 * The crawl renders every page once, at a desktop width, which says nothing about a phone. This
 * renders a small sample again at phone width and measures one thing: whether the page is wider
 * than the screen, so a person has to scroll sideways to read it. That is the failure a visitor
 * actually feels, and it cannot be seen in the markup: a page with a correct viewport tag still
 * overflows if one table or image has a fixed width.
 *
 * A sample, not every page. A second render doubles the cost of each page it touches, and layout
 * comes from shared templates: if the homepage and the top-level pages fit, the template fits.
 * The sample is the shallowest pages in URL order, so it is the same set on every crawl.
 */
export interface MobileRender {
  url: string
  /** The CSS width the page was rendered at. */
  viewportWidth: number
  /** How wide the document actually laid out. Equal to the viewport when it fits. */
  contentWidth: number
  /** contentWidth - viewportWidth, never below zero. */
  overflowPx: number
}

/** A common small phone. Narrow enough to expose a fixed-width layout, not an extreme. */
export const MOBILE_VIEWPORT = { width: 375, height: 667 }

export const DEFAULT_MOBILE_SAMPLE = 5

/** The pages to render at phone width: successful HTML pages, shallowest first, then by URL. */
export function mobileSample(pages: readonly CrawledPage[], limit: number): CrawledPage[] {
  const seen = new Set<string>()
  return [...pages]
    .filter((page) => page.status === 200 && !page.error && page.renderedHtml.length > 0)
    .sort((a, b) => a.depth - b.depth || (a.finalUrl < b.finalUrl ? -1 : 1))
    .filter((page) => {
      if (seen.has(page.finalUrl)) return false
      seen.add(page.finalUrl)
      return true
    })
    .slice(0, Math.max(0, limit))
}

export async function checkMobileRenders(
  context: BrowserContext,
  pages: readonly CrawledPage[],
  options: { limit: number; timeoutMs?: number },
): Promise<MobileRender[]> {
  const sample = mobileSample(pages, options.limit)
  if (sample.length === 0) return []

  // The context's egress guard already vets every request this page makes.
  const page = await context.newPage()
  const results: MobileRender[] = []
  try {
    await page.setViewportSize(MOBILE_VIEWPORT)
    for (const target of sample) {
      try {
        await page.goto(target.finalUrl, {
          waitUntil: 'load',
          timeout: options.timeoutMs ?? 30_000,
        })
        // Late-loading content is often what overflows (a table, an embed), so let it arrive.
        await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {})
        // A string, because this package compiles without DOM types and the code runs in the page.
        const contentWidth = await page.evaluate<number>(
          'Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)',
        )
        results.push({
          url: target.finalUrl,
          viewportWidth: MOBILE_VIEWPORT.width,
          contentWidth,
          overflowPx: Math.max(0, contentWidth - MOBILE_VIEWPORT.width),
        })
      } catch {
        // A page that will not load at phone width is not evidence about its layout. Skip it.
      }
    }
  } finally {
    await page.close()
  }
  return results
}
