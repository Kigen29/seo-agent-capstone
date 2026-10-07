import type { CompetitorSnapshot, WatchedPage } from './snapshot.js'

/**
 * What differs between two snapshots of one competitor. A pure function of the two.
 *
 * Deliberately narrow. It reports that a title is not the string it was last week, and stops:
 * whether the new title is better, what they were trying to do, and whether it worked are not
 * things two strings can tell anybody.
 */

export type ChangeKind = 'title' | 'description' | 'h1' | 'new_url'

export interface CompetitorChange {
  kind: ChangeKind
  url: string
  /** Null when the page had no such element before, or for a new URL. */
  before: string | null
  /** Null when the element was removed, or for a new URL. */
  after: string | null
}

/**
 * How many new URLs one diff reports.
 *
 * A competitor relaunching their site adds thousands of URLs in a week. Past a point the list is
 * not information, and each row is stored, so the list is capped. The first in alphabetical order
 * are kept, which is arbitrary and at least the same choice every week.
 */
export const MAX_NEW_URLS = 50

const FIELDS: { kind: Exclude<ChangeKind, 'new_url'>; of: (page: WatchedPage) => string | null }[] =
  [
    { kind: 'title', of: (page) => page.title },
    { kind: 'description', of: (page) => page.description },
    { kind: 'h1', of: (page) => page.h1 },
  ]

export function diffSnapshots(
  before: CompetitorSnapshot,
  after: CompetitorSnapshot,
): CompetitorChange[] {
  // A week we could not read is an absence of evidence. Diffing against it would report every
  // page as changed, which is the one thing this function must not invent.
  if (before.note !== null || after.note !== null) return []

  const changes: CompetitorChange[] = []
  const earlier = new Map(before.pages.map((page) => [page.url, page]))

  for (const page of after.pages) {
    // A page read this week and not last week is not a change to that page. If it is new to
    // their sitemap it is reported below, as a new URL.
    const previous = earlier.get(page.url)
    if (!previous) continue

    for (const field of FIELDS) {
      const was = field.of(previous)
      const is = field.of(page)
      if (was !== is) changes.push({ kind: field.kind, url: page.url, before: was, after: is })
    }
  }

  /**
   * New URLs only when last week's sitemap was read too. The first time a sitemap is seen, every
   * URL in it is "new" to us and none of it is new to them.
   */
  if (before.sitemapUrls.length > 0) {
    const known = new Set(before.sitemapUrls)
    const added = after.sitemapUrls.filter((url) => !known.has(url)).sort()
    for (const url of added.slice(0, MAX_NEW_URLS)) {
      changes.push({ kind: 'new_url', url, before: null, after: null })
    }
  }

  return changes
}
