import { hostOf } from '../visibility/citation.js'
import { postTask, type DataForSeoCredentials } from '../dataforseo/request.js'
import {
  BacklinkRequestError,
  type BacklinkProvider,
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

/**
 * How many referring domains to enumerate by default.
 *
 * The vendor charges $0.024 for the request plus $0.000036 per row, so a hundred rows costs about
 * two and a half cents and a thousand costs about six. A hundred is enough for the one thing the
 * slice is used for, which is checking which of a handful of mentioning domains already link, and
 * it keeps a single audit comfortably inside a one-dollar daily cap.
 */
export const DEFAULT_LIMIT = 100

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
  }
}
