import { publicFetch, type PublicFetchOptions } from '../http/public-fetch.js'
import type { SerpProvider, SerpSource } from '../serp/types.js'
import { hostOf, sameSite } from '../visibility/citation.js'
import {
  classifyContributorPage,
  contributorQueries,
  type ContributorVerdict,
} from './link-sellers.js'

/**
 * Places that might publish this client, found and then checked.
 *
 * The competitor feature this answers is LinkSeeker: type a niche, get "44 link building
 * opportunities", emailed as a PDF. Two things are wrong with that and both are fixable.
 *
 * The first is framing. Presented as link building, guest posting at scale is the tactic Google's
 * link spam policy describes, and CLAUDE.md rule 7 forbids us to recommend it. Presented as
 * **mention building** it is a different activity with better evidence behind it: branded mentions
 * correlate 0.664 with AI Overview visibility against 0.218 for backlinks (ADR-0018), and 84% of
 * AI citations come from earned media. The ask changes from "will you link to me" to "may I write
 * something for you", and the thing being sought is coverage.
 *
 * The second is that the list is unchecked. A search for `"tiles" "write for us"` returns sellers
 * alongside publications, because sellers optimise for exactly that phrase. So every candidate's
 * page is fetched and read before it reaches a human, and the ones selling placements are named as
 * refused rather than silently dropped: a filter nobody can see is a filter nobody can check.
 *
 * Nothing here sends anything. Drafting a pitch is `draftOutreach`, which refuses without a
 * concrete fact, and sending is a human's act in their own mail client (rule 6).
 */

export interface ContributorCandidate {
  domain: string
  /** The page that invites contributions, which is what a human should read first. */
  url: string
  title?: string
  snippet?: string
  verdict: ContributorVerdict
  /** The phrases that decided the verdict, so a human can disagree with the evidence. */
  matched: string[]
  /**
   * How well the page's own words match the niche searched for.
   *
   * Deliberately crude and deliberately visible: the share of the niche's words that appear in the
   * title and snippet. It is a sort order, not a score anybody should defend.
   */
  relevance: number
}

export interface ContributorSearch {
  niche: string
  /** Candidates that invite contributions, best match first. */
  opportunities: ContributorCandidate[]
  /** Candidates refused for selling placements, named so the exclusion is auditable. */
  refused: ContributorCandidate[]
  /** How many queries were billed to produce this. */
  queriesRun: number
}

export interface FindContributorsOptions {
  niche: string
  /** The client's own domain, excluded from its own opportunity list. */
  clientDomain?: string
  /** A market word for the queries, e.g. 'Kenya'. Geographic scope matters for what gets cited. */
  locale?: string
  /** ISO country for the SERP query itself. */
  country?: string
  /** How many queries to bill. Each is a paid SERP call. */
  maxQueries?: number
  /** How many candidate pages to fetch and read. Free, but not instant. */
  maxFetched?: number
  /** Injected so the whole search runs with no network in a test. */
  fetchOptions?: PublicFetchOptions
}

/** One query is enough to prove the shape; three is the most any caller should pay for. */
const DEFAULT_QUERIES = 2

/** Reading twelve pages takes a few seconds and covers the first page of results twice over. */
const DEFAULT_FETCHED = 12

/** The niche's own words, for the crude relevance sort. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)

export async function findContributors(
  provider: SerpProvider,
  options: FindContributorsOptions,
): Promise<ContributorSearch> {
  const queries = contributorQueries(options.niche, options.locale).slice(
    0,
    Math.max(1, options.maxQueries ?? DEFAULT_QUERIES),
  )

  const seen = new Map<string, SerpSource>()
  let queriesRun = 0

  for (const query of queries) {
    try {
      const result = await provider.mentions(query, {
        ...(options.country ? { country: options.country } : {}),
      })
      queriesRun += 1

      for (const source of result.sources) {
        const host = hostOf(source.url)
        if (!host) continue
        // The client's own "write for us" page is not an opportunity for the client.
        if (options.clientDomain && sameSite(host, options.clientDomain)) continue
        // One page per domain. Three matching pages on one publication is one publication.
        if (!seen.has(host)) seen.set(host, source)
      }
    } catch {
      // A failed query costs this search one source of candidates, not the whole search. The
      // count of queries actually run travels with the result, so a caller can see it happened.
      continue
    }
  }

  const niche = new Set(wordsOf(options.niche))
  const candidates = [...seen.entries()].slice(0, options.maxFetched ?? DEFAULT_FETCHED)

  const checked = await Promise.all(
    candidates.map(async ([domain, source]) => {
      const text = `${source.title ?? ''} ${source.snippet ?? ''}`
      const hits = wordsOf(text).filter((word) => niche.has(word)).length
      const relevance = niche.size === 0 ? 0 : Math.min(1, hits / niche.size)

      /**
       * The page itself, through the same guard the public check uses.
       *
       * These URLs come from a search engine rather than from a user, which makes them less
       * hostile and not safe: a search result can point anywhere, and the reason to use the guard
       * is that it costs nothing to keep using it.
       */
      let verdict: ContributorVerdict = 'neither'
      let matched: string[] = []

      try {
        const page = await publicFetch(source.url, {
          maxBytes: 500_000,
          timeoutMs: 8_000,
          ...options.fetchOptions,
        })
        const read = classifyContributorPage(page.body)
        verdict = read.verdict
        matched = read.matched
      } catch {
        // Unreachable, too slow, or refused by the guard. An unread page is not an opportunity:
        // we would be recommending a site we could not open.
        verdict = 'neither'
      }

      return {
        domain,
        url: source.url,
        ...(source.title ? { title: source.title } : {}),
        ...(source.snippet ? { snippet: source.snippet } : {}),
        verdict,
        matched,
        relevance,
      } satisfies ContributorCandidate
    }),
  )

  return {
    niche: options.niche,
    opportunities: checked
      .filter((candidate) => candidate.verdict === 'inviting')
      .sort((a, b) => b.relevance - a.relevance || a.domain.localeCompare(b.domain)),
    refused: checked.filter((candidate) => candidate.verdict === 'selling'),
    queriesRun,
  }
}
