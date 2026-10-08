import type { AuthorityMetrics } from '@seo/core'
import type { SerpSource } from '../serp/types.js'
import { hostOf, sameSite } from '../visibility/citation.js'

/**
 * Sites the client has said are not about them.
 *
 * The exact-name check (ADR-0039) answers "does this page contain the name?". It cannot answer
 * "is this the same business?" when another company has the very same name, and nothing on a
 * page can. That is a fact only the client holds, so they are given a way to state it, and it is
 * applied in two places:
 *
 *   - when an audit measures, before anything is counted, so no finding is raised about a site
 *     that is not theirs;
 *   - when a stored audit is read back, so excluding a site takes effect on the page at once
 *     and does not wait for the next audit.
 *
 * Matched by site, so excluding `example.com` also excludes `blog.example.com`.
 */
export const MAX_MENTION_EXCLUSIONS = 50

const isExcluded = (host: string, excluded: readonly string[]): boolean =>
  excluded.some((domain) => sameSite(domain, host))

/** Drop search results on an excluded site. Used while measuring. */
export function withoutExcludedSources(
  sources: readonly SerpSource[],
  excluded: readonly string[],
): SerpSource[] {
  if (excluded.length === 0) return [...sources]
  return sources.filter((source) => {
    const host = hostOf(source.url)
    return !host || !isExcluded(host, excluded)
  })
}

/**
 * Take excluded sites out of figures that were already measured.
 *
 * The counts are lowered by exactly the sites removed, not recounted from the list: the list of
 * pages is capped and the counts are not, so recounting would quietly shrink a large footprint.
 * An audit that kept no page list has nothing to work from and is returned as it is; the
 * exclusion then applies from the next audit.
 */
export function applyMentionExclusions(
  metrics: AuthorityMetrics,
  excluded: readonly string[],
): AuthorityMetrics {
  if (excluded.length === 0 || !metrics.mentions) return metrics

  const removed = metrics.mentions.filter((mention) => isExcluded(mention.domain, excluded))
  if (removed.length === 0) return metrics

  const sitesRemoved = (kind: 'earned' | 'self_published'): number =>
    new Set(removed.filter((mention) => mention.kind === kind).map((mention) => mention.domain))
      .size

  const lowered = (count: number | null, by: number): number | null =>
    count === null ? null : Math.max(0, count - by)

  return {
    ...metrics,
    earnedDomains: lowered(metrics.earnedDomains, sitesRemoved('earned')),
    selfPublishedDomains: lowered(metrics.selfPublishedDomains, sitesRemoved('self_published')),
    mentions: metrics.mentions.filter((mention) => !isExcluded(mention.domain, excluded)),
    ...(metrics.unlinkedMentions
      ? {
          unlinkedMentions: metrics.unlinkedMentions.filter(
            (domain) => !isExcluded(domain, excluded),
          ),
        }
      : {}),
  }
}
