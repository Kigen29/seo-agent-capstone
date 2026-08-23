import { postTask, type DataForSeoCredentials } from '../dataforseo/request.js'
import type { KeywordIdea, KeywordProvider } from './types.js'

/**
 * DataForSEO Labs' keyword ideas, one implementation of the KeywordProvider seam.
 *
 * Parsed defensively field by field, like every other vendor adapter here: an external API's shape
 * is a promise somebody else can break on a Tuesday, and the failure mode we care about is not a
 * crash but a surface that quietly returns nothing while looking healthy.
 */

const PATH = '/v3/dataforseo_labs/google/keyword_ideas/live'

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
  }
}
