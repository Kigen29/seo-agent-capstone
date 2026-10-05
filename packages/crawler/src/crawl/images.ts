import type { BrowserContext } from 'playwright'
import type { BlockedRequest, EgressGuard } from './egress.js'
import { guardedRequest } from './outbound.js'
import type { CrawledPage } from './types.js'

/**
 * How heavy are the images the pages use?
 *
 * The crawl does not download images: it blocks them, because rendering fifty pages' worth of
 * photographs to read their text would be most of the crawl's time and somebody else's bandwidth.
 * So the one thing a page-weight audit most wants to know was never measured.
 *
 * This asks for each image's headers afterwards, with a HEAD request, and reads the size and type
 * the server declares. Nothing is downloaded. An image whose server does not answer HEAD, or does
 * not declare a length, is recorded as unknown and never guessed at.
 *
 * Capped, and most-used first, so the logo and hero images that every page carries are always
 * among the ones measured and the set is the same on every crawl.
 */
export interface ImageWeight {
  url: string
  /** Declared Content-Length, or null when the server did not say. */
  bytes: number | null
  /** Declared Content-Type without parameters, lowercased, or null. */
  contentType: string | null
  /** The crawled pages that use the image. */
  usedOn: string[]
}

export const DEFAULT_IMAGE_SAMPLE = 60

/** The distinct images on the crawled pages, most-used first, then by URL. */
export function imageCandidates(
  pages: readonly CrawledPage[],
  limit: number,
): { url: string; usedOn: string[] }[] {
  const byUrl = new Map<string, Set<string>>()
  for (const page of pages) {
    if (page.status !== 200) continue
    for (const image of page.extract.images) {
      if (!image.resolved) continue
      let target: URL
      try {
        target = new URL(image.resolved)
      } catch {
        continue
      }
      // An inline data: image has no request to measure, and its weight is the page's own.
      if (target.protocol !== 'http:' && target.protocol !== 'https:') continue
      target.hash = ''
      const key = target.toString()
      byUrl.set(key, (byUrl.get(key) ?? new Set()).add(page.finalUrl))
    }
  }

  return [...byUrl.entries()]
    .map(([url, on]) => ({ url, usedOn: [...on].sort() }))
    .sort((a, b) => b.usedOn.length - a.usedOn.length || (a.url < b.url ? -1 : 1))
    .slice(0, Math.max(0, limit))
}

export async function measureImages(
  context: BrowserContext,
  guard: EgressGuard,
  pages: readonly CrawledPage[],
  options: {
    limit: number
    timeoutMs?: number
    concurrency?: number
    onBlocked?: (blocked: BlockedRequest) => void
  },
): Promise<ImageWeight[]> {
  const candidates = imageCandidates(pages, options.limit)
  const results: ImageWeight[] = new Array<ImageWeight>(candidates.length)

  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      const candidate = candidates[index]
      if (!candidate) return

      let bytes: number | null = null
      let contentType: string | null = null
      try {
        const response = await guardedRequest(
          context,
          guard,
          'HEAD',
          candidate.url,
          options.timeoutMs ?? 10_000,
          options.onBlocked,
        )
        if (response.status !== null && response.status >= 200 && response.status < 300) {
          const length = Number(response.headers?.['content-length'])
          // Zero is what some servers send for HEAD when they do not know. That is "unknown".
          bytes = Number.isFinite(length) && length > 0 ? length : null
          contentType =
            response.headers?.['content-type']?.split(';')[0]?.trim().toLowerCase() || null
        }
      } catch {
        // No answer is not a weight. Leave both unknown.
      }
      results[index] = { ...candidate, bytes, contentType }
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, () => worker()))
  return results
}
