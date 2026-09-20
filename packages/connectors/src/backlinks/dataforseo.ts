import { hostOf } from '../visibility/citation.js'
import { postTask, type DataForSeoCredentials } from '../dataforseo/request.js'
import {
  BacklinkRequestError,
  type BacklinkProvider,
  type LinkGap,
  type LinkGapDomain,
  type ReferringDomain,
  type ReferringDomains,
} from './types.js'

/**
 * DataForSEO's Backlinks API, one implementation of the BacklinkProvider seam.
 *
 * Nothing above this file knows the vendor exists. The response shape below is the documented one
 * and is parsed defensively rather than trusted, because an external API's shape is a promise
 * somebody else can break on a Tuesday: every field is checked before it is read, and anything
 * unrecognised degrades to "no data" rather than throwing.
 */

const PATH = '/v3/backlinks/referring_domains/live'
const INTERSECTION_PATH = '/v3/backlinks/domain_intersection/live'

/**
 * The most competitors one intersection query will compare.
 *
 * The vendor allows twenty targets. Three matches `MAX_COMPARED_COMPETITORS` on the mention side,
 * and the reason is the same: the question is whether a domain links to the client's whole
 * competitive set and not to them, and a set of three already answers it. It also keeps the
 * `intersection_mode: 'all'` result from collapsing to nothing, which is what a long target list
 * does, since almost no domain links to eight rivals at once.
 */
export const MAX_INTERSECTION_TARGETS = 3

/**
 * How many referring domains to enumerate by default.
 *
 * The vendor charges $0.024 for the request plus $0.000036 per row, so a hundred rows costs about
 * two and a half cents and a thousand costs about six. A hundred is enough for the one thing the
 * slice is used for, which is checking which of a handful of mentioning domains already link, and
 * it keeps a single audit comfortably inside a one-dollar daily cap.
 */
export const DEFAULT_LIMIT = 100

/**
 * How many gap domains to enumerate by default.
 *
 * Smaller than the referring-domains slice, because this list is read by a human deciding who to
 * contact rather than compared set-wise against a mention footprint. Fifty candidates is more
 * outreach than any client will do between audits, and the request is billed per row.
 */
export const DEFAULT_INTERSECTION_LIMIT = 50

/**
 * The intersection response, as the vendor actually returns it.
 *
 * Verified against a live call rather than read off the documentation, because the shape is
 * surprising in a way that matters: each row's `domain_intersection` is keyed by *target
 * position*, and the `target` field inside each of those is the **referring** domain, repeated,
 * not the target it links to. Reading `target` as the competitor would produce a gap list of the
 * client's own rivals, which looks plausible and is nonsense.
 */
interface IntersectionResult {
  total_count?: number
  items?: {
    domain_intersection?: Record<
      string,
      {
        /** The referring domain. The same value under every key. */
        target?: string
        rank?: number
        backlinks?: number
        referring_pages?: number
        referring_pages_nofollow?: number
        backlinks_spam_score?: number
      }
    >
    summary?: { intersections_count?: number }
  }[]
}

/** The slice of DataForSEO's result we read. Everything else is ignored on purpose. */
interface ReferringDomainsResult {
  target?: string
  total_count?: number
  items?: {
    domain?: string
    rank?: number
    backlinks?: number
    referring_pages?: number
    referring_pages_nofollow?: number
  }[]
}

/**
 * Whether every link from this domain is nofollow.
 *
 * The vendor reports counts rather than a flag, so this is derived: all of the referring pages
 * being nofollow is what "this domain does not pass authority" means. Absent counts produce
 * `undefined` rather than `false`, because not knowing and knowing-it-is-followed are different
 * facts and only one of them should read as good news.
 */
function allNofollow(pages?: number, nofollow?: number): boolean | undefined {
  if (typeof pages !== 'number' || typeof nofollow !== 'number' || pages <= 0) return undefined
  return nofollow >= pages
}

export function createDataForSeoBacklinks(credentials: DataForSeoCredentials): BacklinkProvider {
  return {
    name: 'dataforseo',

    async referringDomains(domain, limit = DEFAULT_LIMIT): Promise<ReferringDomains> {
      const target = hostOf(domain)
      if (!target) {
        throw new BacklinkRequestError(400, `Not a domain: "${domain}".`)
      }

      const result = await postTask<ReferringDomainsResult>(credentials, PATH, {
        target,
        limit,
        // Highest authority first, so a truncated slice is the most useful part of the index
        // rather than an arbitrary one.
        order_by: ['rank,desc'],
      })

      // A target with no backlinks returns no result rather than an empty list. That is a fact
      // about the domain, not a failure, so it becomes a zero rather than an exception.
      if (!result) return { target, total: 0, domains: [], limit }

      const domains: ReferringDomain[] = []
      for (const item of result.items ?? []) {
        const host = typeof item.domain === 'string' ? hostOf(item.domain) : null
        // A row we cannot resolve to a host cannot be compared against a mention, so it is not a
        // referring domain for our purposes. Keeping it would inflate the overlap arithmetic.
        if (!host) continue

        const nofollow = allNofollow(item.referring_pages, item.referring_pages_nofollow)

        domains.push({
          domain: host,
          ...(typeof item.backlinks === 'number' ? { backlinks: item.backlinks } : {}),
          ...(typeof item.rank === 'number' ? { rank: item.rank } : {}),
          ...(nofollow === undefined ? {} : { nofollow }),
        })
      }

      return {
        target: typeof result.target === 'string' ? result.target : target,
        /**
         * `total_count` when the vendor gives it, otherwise what we actually received. Falling
         * back to the slice length is the conservative direction: it under-reports rather than
         * inventing a number, and a caller comparing it against `limit` can see the result may be
         * truncated.
         */
        total: typeof result.total_count === 'number' ? result.total_count : domains.length,
        domains,
        limit,
      }
    },

    async intersection(targets, exclude, limit = DEFAULT_INTERSECTION_LIMIT): Promise<LinkGap> {
      const excluded = hostOf(exclude)
      if (!excluded) {
        throw new BacklinkRequestError(400, `Not a domain: "${exclude}".`)
      }

      const hosts = targets
        .map((target) => hostOf(target))
        .filter((host): host is string => host !== null)
        .filter((host) => host !== excluded)
        .slice(0, MAX_INTERSECTION_TARGETS)

      // No comparable competitor is not a failure and not a gap: it is a question that cannot be
      // asked. Returning empty here rather than calling means we never pay for a query whose
      // answer we already know.
      if (hosts.length === 0) {
        return { targets: [], excluded, total: 0, domains: [], limit }
      }

      const result = await postTask<IntersectionResult>(credentials, INTERSECTION_PATH, {
        // The vendor keys targets by position, starting at 1, and the same keys come back on
        // every row.
        targets: Object.fromEntries(hosts.map((host, index) => [String(index + 1), host])),
        // The gap itself. Excluding the client here rather than filtering afterwards is what
        // makes every row a domain that genuinely does not link to them.
        exclude_targets: [excluded],
        // Domains linking to *all* the compared targets. 'partial' would return anything linking
        // to any one of them, which for three rivals is most of the web's link farms.
        intersection_mode: 'all',
        limit,
        order_by: ['1.rank,desc'],
      })

      if (!result) return { targets: hosts, excluded, total: 0, domains: [], limit }

      const domains: LinkGapDomain[] = []
      for (const item of result.items ?? []) {
        const entries = Object.values(item.domain_intersection ?? {})
        const first = entries[0]
        const host = typeof first?.target === 'string' ? hostOf(first.target) : null
        if (!host) continue

        const backlinks = sum(entries.map((entry) => entry.backlinks))
        const pages = sum(entries.map((entry) => entry.referring_pages))
        const nofollowPages = sum(entries.map((entry) => entry.referring_pages_nofollow))
        // The worst score across the targets, because a domain is as spammy as its worst
        // reading rather than as clean as its most flattering one.
        const spam = entries
          .map((entry) => entry.backlinks_spam_score)
          .filter((score): score is number => typeof score === 'number')

        domains.push({
          domain: host,
          intersections:
            typeof item.summary?.intersections_count === 'number'
              ? item.summary.intersections_count
              : entries.length,
          ...(backlinks === undefined ? {} : { backlinks }),
          ...(typeof first.rank === 'number' ? { rank: first.rank } : {}),
          ...(spam.length > 0 ? { spamScore: Math.max(...spam) } : {}),
          ...(allNofollow(pages, nofollowPages) === undefined
            ? {}
            : { nofollow: allNofollow(pages, nofollowPages) as boolean }),
        })
      }

      return {
        targets: hosts,
        excluded,
        total: typeof result.total_count === 'number' ? result.total_count : domains.length,
        domains,
        limit,
      }
    },
  }
}

/** Add the numbers that are actually numbers, or undefined when none of them were. */
function sum(values: (number | undefined)[]): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === 'number')
  return numbers.length === 0 ? undefined : numbers.reduce((total, value) => total + value, 0)
}
