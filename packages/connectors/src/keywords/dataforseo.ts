import { postTask, type DataForSeoCredentials } from '../dataforseo/request.js'
import { hostOf } from '../visibility/citation.js'
import type { KeywordGap, KeywordGapEntry, KeywordIdea, KeywordProvider } from './types.js'

/**
 * DataForSEO Labs' keyword ideas, one implementation of the KeywordProvider seam.
 *
 * Parsed defensively field by field, like every other vendor adapter here: an external API's shape
 * is a promise somebody else can break on a Tuesday, and the failure mode we care about is not a
 * crash but a surface that quietly returns nothing while looking healthy.
 */

const PATH = '/v3/dataforseo_labs/google/keyword_ideas/live'
const GAP_PATH = '/v3/dataforseo_labs/google/domain_intersection/live'

/**
 * How many gap keywords to return by default.
 *
 * Half the ideas default, because this list is read differently: ideas are skimmed while writing,
 * a gap is worked through one page at a time. Twenty-five is already more pages than a small site
 * will publish between audits, and rows are most of the bill.
 */
export const DEFAULT_GAP_LIMIT = 25

/**
 * How many ideas to return by default.
 *
 * The vendor charges $0.012 per request plus $0.00012 per keyword, so the row count is most of the
 * bill: fifty ideas costs under two cents, and the vendor's own default of 700 would cost nine.
 * Fifty is comfortably more than a person writing a page will read, and a caller who wants the
 * long tail can ask for it and pay for it deliberately.
 */
export const DEFAULT_LIMIT = 50

/** The hard ceiling, matching the vendor's own. Bounded here too so a caller cannot spend past it. */
export const MAX_LIMIT = 1000

/**
 * A market must be named: DataForSEO requires a location and search volume is per-market, so a
 * silent default would confidently measure the wrong country's demand.
 */
const DEFAULT_LOCATION = 'United States'

/**
 * The slice of the domain-intersection response we read.
 *
 * `first_domain_serp_element` is the competitor's result, because the competitor is sent as
 * `target1`. Sending them the other way round and reading the same field would report the
 * client's own rankings as the gap, which looks like data and is the opposite of the answer.
 */
interface DomainIntersectionResult {
  items?: {
    keyword_data?: {
      keyword?: string
      keyword_info?: {
        search_volume?: number | null
        competition?: number | null
        cpc?: number | null
      }
    }
    first_domain_serp_element?: {
      rank_absolute?: number | null
      url?: string
    }
  }[]
}

/** The slice of the response we read. Everything else is ignored on purpose. */
interface KeywordIdeasResult {
  items?: {
    keyword?: string
    keyword_info?: {
      search_volume?: number | null
      competition?: number | null
      cpc?: number | null
    }
  }[]
}

/**
 * An ISO country code as a location name DataForSEO understands.
 *
 * `Intl.DisplayNames` rather than a hand-maintained table: the mapping is a standard the runtime
 * already ships, so it covers every country and cannot fall behind. A table would start with the
 * five markets we thought of and silently reject the sixth.
 */
function locationFor(country: string | undefined): string {
  if (!country) return DEFAULT_LOCATION

  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(country.toUpperCase()) ?? country
  } catch {
    // An unrecognised code is passed through rather than swallowed: DataForSEO will reject it with
    // a task-level error naming the location, which is a better diagnosis than silently switching
    // the client to a market they did not ask about.
    return country
  }
}

/** A number, or null. Guards against the vendor sending a string or omitting the field. */
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null)

export function createDataForSeoKeywords(credentials: DataForSeoCredentials): KeywordProvider {
  return {
    name: 'dataforseo',

    async ideas(seed, options): Promise<KeywordIdea[]> {
      const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_LIMIT), MAX_LIMIT)

      const result = await postTask<KeywordIdeasResult>(credentials, PATH, {
        // The endpoint takes an array; we send exactly one seed, because every task is billed and
        // batching would make the budget guard's per-call accounting a lie.
        keywords: [seed.trim().toLowerCase()],
        location_name: locationFor(options?.country),
        language_code: options?.language ?? 'en',
        limit,
      })

      // No result is a real answer: a seed nobody searches for has no ideas. Returning an empty
      // list rather than throwing keeps that distinct from the request having failed.
      if (!result) return []

      const ideas: KeywordIdea[] = []
      for (const item of result.items ?? []) {
        if (typeof item.keyword !== 'string' || !item.keyword.trim()) continue

        ideas.push({
          keyword: item.keyword,
          searchVolume: numberOrNull(item.keyword_info?.search_volume),
          competition: numberOrNull(item.keyword_info?.competition),
          cpc: numberOrNull(item.keyword_info?.cpc),
        })
      }

      return ideas
    },

    async gap(client, competitor, options): Promise<KeywordGap> {
      const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_GAP_LIMIT), MAX_LIMIT)
      const rival = hostOf(competitor) ?? competitor.trim().toLowerCase()
      const own = hostOf(client) ?? client.trim().toLowerCase()

      const result = await postTask<DomainIntersectionResult>(credentials, GAP_PATH, {
        // target1 is the domain whose rankings come back, target2 the one being subtracted. With
        // `intersections: false` the endpoint answers "what does target1 rank for that target2
        // does not", which is the gap read in the only direction worth paying for.
        target1: rival,
        target2: own,
        intersections: false,
        // Organic only. Paid placements are somebody's ad budget rather than a ranking a client
        // could earn, and presenting them as a content gap would be advice to buy traffic.
        item_types: ['organic'],
        location_name: locationFor(options?.country),
        language_code: options?.language ?? 'en',
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
        limit,
      })

      if (!result) return { competitor: rival, client: own, keywords: [], limit }

      const keywords: KeywordGapEntry[] = []
      for (const item of result.items ?? []) {
        const keyword = item.keyword_data?.keyword
        if (typeof keyword !== 'string' || !keyword.trim()) continue

        const serp = item.first_domain_serp_element
        const position = numberOrNull(serp?.rank_absolute)

        keywords.push({
          keyword,
          searchVolume: numberOrNull(item.keyword_data?.keyword_info?.search_volume),
          competition: numberOrNull(item.keyword_data?.keyword_info?.competition),
          cpc: numberOrNull(item.keyword_data?.keyword_info?.cpc),
          competitorPosition: position,
          ...(typeof serp?.url === 'string' ? { competitorUrl: serp.url } : {}),
        })
      }

      return { competitor: rival, client: own, keywords, limit }
    },
  }
}

/**
 * Remove the keywords Search Console says the client already appears for.
 *
 * The correction that makes this feature worth shipping, and it is deliberately not inside the
 * adapter. A third-party index sees a small site in a small market badly, so its "gap" contains a
 * long tail of terms the client already ranks for; we hold the client's own Search Console data,
 * which is the truth about that. Nothing else in the category can do this, because nothing else
 * has the client's grant.
 *
 * Matching is on the exact query string, lowercased and trimmed. A looser match would start
 * deciding that two different searches are the same search, which is a judgement rather than a
 * comparison.
 */
export function subtractKnownQueries(
  gap: KeywordGap,
  queries: Iterable<string>,
): { gap: KeywordGap; removed: number } {
  const known = new Set([...queries].map((query) => query.trim().toLowerCase()))
  if (known.size === 0) return { gap, removed: 0 }

  const keywords = gap.keywords.filter((entry) => !known.has(entry.keyword.trim().toLowerCase()))

  return { gap: { ...gap, keywords }, removed: gap.keywords.length - keywords.length }
}
