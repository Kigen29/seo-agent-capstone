import {
  SerpRequestError,
  type SerpProvider,
  type SerpQueryOptions,
  type SerpSource,
} from './types.js'

/**
 * SerpApi, one implementation of the SerpProvider seam.
 *
 * Nothing above this file knows the vendor exists. Swapping to DataForSEO is a new file next to
 * this one and an environment variable, because the measurement code only ever sees the interface
 * (ADR-0016).
 *
 * The response shapes below are SerpApi's documented ones. They are parsed defensively rather than
 * trusted, because an external API's shape is a promise somebody else can break on a Tuesday: every
 * field is checked before it is read, and anything unrecognised degrades to "no data" rather than
 * throwing. The contract test encodes what we believe the shape is, so a vendor change fails a test
 * here instead of silently producing empty findings in production.
 */

const ENDPOINT = 'https://serpapi.com/search.json'

export interface SerpApiOptions {
  apiKey: string
  /** Injected so the contract test can drive it without a network or a key. */
  fetch?: typeof globalThis.fetch
  /** Default geography for every query. Overridable per call. */
  country?: string
  language?: string
}

/** The slice of SerpApi's response we read. Everything else is ignored on purpose. */
interface SerpApiResponse {
  error?: string
  ai_overview?: {
    text_blocks?: TextBlock[]
    references?: { link?: string; title?: string; snippet?: string }[]
    /**
     * SerpApi sometimes defers the overview to a second request rather than inlining it. We do
     * not follow it: that is a second billable query for the same measurement, and doubling the
     * cost of the most expensive axis without anyone asking is not a decision a parser should
     * make. It is reported as "no overview this run", which is honest and free.
     */
    page_token?: string
  }
  organic_results?: { link?: string; title?: string; snippet?: string }[]
  search_information?: { total_results?: number }
}

interface TextBlock {
  type?: string
  snippet?: string
  /** Nested blocks, which is how SerpApi represents bullet lists. */
  list?: TextBlock[]
}

/** Flatten SerpApi's nested text blocks into the plain answer text the citation parser reads. */
function flatten(blocks: readonly TextBlock[] | undefined): string {
  if (!blocks) return ''

  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block.snippet === 'string' && block.snippet.trim()) parts.push(block.snippet.trim())
    if (Array.isArray(block.list)) {
      const nested = flatten(block.list)
      if (nested) parts.push(nested)
    }
  }
  return parts.join('\n')
}

function toSources(
  raw: readonly { link?: string; title?: string; snippet?: string }[] | undefined,
): SerpSource[] {
  if (!raw) return []

  const sources: SerpSource[] = []
  for (const entry of raw) {
    // A reference with no link is not a source we can match a domain against, so it is not a
    // source. Keeping it would inflate the count with entries the citation parser must ignore.
    if (typeof entry.link !== 'string' || !entry.link) continue
    sources.push({
      url: entry.link,
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.snippet ? { snippet: entry.snippet } : {}),
    })
  }
  return sources
}

export function createSerpApiProvider(options: SerpApiOptions): SerpProvider {
  const doFetch = options.fetch ?? globalThis.fetch

  async function search(query: string, query_options?: SerpQueryOptions): Promise<SerpApiResponse> {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: options.apiKey,
      gl: query_options?.country ?? options.country ?? 'us',
      hl: query_options?.language ?? options.language ?? 'en',
    })

    const response = await doFetch(`${ENDPOINT}?${params.toString()}`)

    if (!response.ok) {
      // The key never appears in the message. An error string is the most likely thing to end up
      // in a log, an issue, or a screenshot, and a leaked SerpApi key is a live billable credential.
      throw new SerpRequestError(
        response.status,
        `SerpApi returned ${response.status} for "${query}".`,
      )
    }

    const body = (await response.json()) as SerpApiResponse

    // SerpApi reports some failures as a 200 with an `error` field, which is exactly the shape
    // that turns a broken integration into a silently empty axis if nobody checks it.
    if (body.error) throw new SerpRequestError(200, `SerpApi: ${body.error}`)

    return body
  }

  return {
    name: 'serpapi',

    async aiOverview(query, queryOptions) {
      const body = await search(query, queryOptions)
      const overview = body.ai_overview

      const text = flatten(overview?.text_blocks)
      const sources = toSources(overview?.references)

      /**
       * `present` is false for two different situations that both mean the same thing to a caller:
       * Google showed no overview, or it deferred one behind a page token we decline to pay twice
       * for. Neither is an error. Plenty of queries simply have no AI Overview, and reporting that
       * as a failure would turn "Google chose not to answer" into "the poll broke".
       */
      return {
        query,
        text,
        sources,
        present: Boolean(overview) && (text !== '' || sources.length > 0),
      }
    },

    async mentions(brand, queryOptions) {
      const body = await search(brand, queryOptions)

      return {
        query: brand,
        sources: toSources(body.organic_results),
        ...(typeof body.search_information?.total_results === 'number'
          ? { estimatedTotal: body.search_information.total_results }
          : {}),
      }
    },
  }
}
