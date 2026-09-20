import { parseFinding, type Finding } from '@seo/core'
import { isQuestion, tokenise, topicWords } from './question-words.js'
import type { SearchAnalyticsRow } from './types.js'

/**
 * Questions the site is already being shown for, and has no page that answers.
 *
 * Every competitor's version of this mines Reddit or an autocomplete endpoint and hands over a
 * list of questions somebody, somewhere, might ask. This one reads the questions Google is
 * *already* putting the client in front of: real impressions, real positions, this site, this
 * month. Demand that exists beats demand that is plausible, and it costs nothing extra to
 * measure because the rows are the same ones the quick-wins step already fetches.
 *
 * A question only becomes a finding when three things hold: the site earns real impressions for
 * it, it ranks off page one, and no crawled page covers its subject. The third is what separates
 * a content gap from a ranking problem. If a page already answers the question and ranks badly,
 * that is a different finding with a different fix, and quick-wins already raises it.
 *
 * The match is deliberately crude and deliberately public: tokens, minus question words and stop
 * words, compared against titles and H1s. A model could judge topical coverage more subtly, and
 * then no one could check its answer or predict when it would change. This one a reader can
 * verify by looking at the page (rule 1).
 */

/** A crawled page, reduced to the parts that say what it is about. */
export interface PageSummary {
  url: string
  title?: string | null
  /** The page's H1s. More than one is its own finding; here they are just more subject text. */
  h1s?: string[]
}

export interface QuestionGapInput {
  siteId: string
  siteUrl: string
  startDate: string
  endDate: string
  /** Rows grouped by the `query` dimension: keys is [query]. */
  rows: SearchAnalyticsRow[]
  /** What the crawl found. An empty list disables the step rather than flagging every question. */
  pages: PageSummary[]
}

/**
 * Below this, a question is noise.
 *
 * Lower than the quick-wins floor of 50 on purpose. Questions are long-tail by nature: a page
 * worth writing often shows up as 30 impressions spread over a handful of phrasings, and a
 * threshold tuned for head terms would hide exactly the gaps this is looking for.
 */
const MIN_IMPRESSIONS = 25

/** Off page one. On page one the site already has an answer Google is willing to show. */
const OFF_PAGE_ONE = 10.5

/**
 * How much of a question's subject a page must cover before we call it answered.
 *
 * Two thirds, not all: "how much do tiles cost in nairobi" reduces to tile, nairobi (cost is a
 * question word), and a page titled "Tile Prices in Nairobi" plainly answers it. Requiring every
 * token would raise a finding for a page that already exists, which is the worst failure this
 * check can have: it sends a client to write a page they have.
 */
const COVERED = 0.6

/**
 * At most this many question findings per audit.
 *
 * The backlog is a queue a human works through, not a report to be admired. Twenty questions is
 * more than any site can act on before the next audit, and an inbox flooded by one check is an
 * inbox nobody reads. They are sorted by impressions, so the cap drops the smallest.
 */
const MAX_FINDINGS = 10

const clampImpact = (raw: number): number => Math.max(1, Math.min(90, Math.round(raw)))

/** Does any crawled page's title or H1 already cover this question's subject? */
function isAnswered(subject: string[], pages: PageSummary[]): boolean {
  const needed = Math.max(1, Math.ceil(subject.length * COVERED))

  return pages.some((page) => {
    const words = new Set([...tokenise(page.title ?? ''), ...(page.h1s ?? []).flatMap(tokenise)])
    if (words.size === 0) return false

    const hits = subject.filter((word) => words.has(word)).length
    return hits >= needed
  })
}

interface Group {
  /** The phrasing with the most impressions. It leads the finding. */
  query: string
  impressions: number
  clicks: number
  position: number
  subject: string[]
  /** Other phrasings of the same question, in the order Search Console reported them. */
  variants: string[]
}

export function evaluateQuestionGaps(input: QuestionGapInput): Finding[] {
  // With nothing crawled there is no way to tell a gap from a page that exists, and guessing
  // would flag every question the site ranks for. Silence is the honest answer.
  if (input.pages.length === 0) return []

  const groups = new Map<string, Group>()

  for (const row of input.rows) {
    const query = row.keys[0]
    if (!query || row.impressions < MIN_IMPRESSIONS || row.position <= OFF_PAGE_ONE) continue
    if (!isQuestion(query)) continue

    const subject = topicWords(query)
    if (subject.length === 0) continue

    // Two phrasings of one question share a subject once their words are sorted, so this key
    // collapses "tile prices nairobi" and "how much are tiles in nairobi" into one finding
    // instead of two that would compete for the same new page.
    const key = [...subject].sort().join(' ')
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        query,
        impressions: row.impressions,
        clicks: row.clicks,
        position: row.position,
        subject,
        variants: [],
      })
      continue
    }

    // The averaged position follows the phrasing we lead with, because a position averaged
    // across phrasings is a number Search Console never reported and nobody could check.
    if (row.impressions > existing.impressions) {
      existing.variants.push(existing.query)
      existing.query = query
      existing.position = row.position
      existing.subject = subject
    } else {
      existing.variants.push(query)
    }

    existing.impressions += row.impressions
    existing.clicks += row.clicks
  }

  const observedAt = new Date().toISOString()

  return [...groups.values()]
    .filter((group) => !isAnswered(group.subject, input.pages))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_FINDINGS)
    .map((group) =>
      parseFinding({
        id: `CONTENT-002#${group.query.toLowerCase().trim()}`,
        siteId: input.siteId,
        ruleId: 'CONTENT-002',
        axis: 'content',
        // Impressions are the whole case for writing the page, so they set the severity. A
        // question drawing a few dozen is worth knowing about; one drawing hundreds is a page
        // the site is currently declining to write.
        severity: group.impressions >= 100 ? 'medium' : 'low',
        confidence: 1,
        title:
          `No page answers "${group.query}"` +
          (group.variants.length > 0 ? ` (asked ${group.variants.length + 1} ways)` : '') +
          `, which already draws ${group.impressions.toLocaleString()} impressions at ` +
          `average position ${group.position.toFixed(1)}`,
        evidence: {
          kind: 'search',
          source: 'gsc',
          observedAt,
          query: group.query,
          position: group.position,
          impressions: group.impressions,
          clicks: group.clicks,
          ctr: group.impressions === 0 ? 0 : group.clicks / group.impressions,
          startDate: input.startDate,
          endDate: input.endDate,
          ...(group.variants.length > 0 ? { relatedQueries: group.variants } : {}),
        },
        // The site, not a page: the point of the finding is that no page is responsible for it.
        affectedUrls: [input.siteUrl],
        estimatedEffort: 'medium',
        estimatedImpact: clampImpact(group.impressions / 25),
        falsification:
          `Publish one page that answers "${group.query}" directly, then re-query Search ` +
          `Console for it 28 days later. The fix failed if that page is not the one receiving ` +
          `these impressions, or if the average position is no better than ` +
          `${group.position.toFixed(1)}. Search Console lags two to three days, so an immediate ` +
          `re-check proves nothing.`,
        fixable: false,
        status: 'open',
      }),
    )
}

/** How many distinct checks this represents, for the scorecard coverage count. */
export const QUESTION_GAP_CHECKS = 1
