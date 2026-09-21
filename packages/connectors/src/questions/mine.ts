import { isQuestion, topicWords } from '../gsc/question-words.js'
import type { SearchAnalyticsRow } from '../gsc/types.js'

/**
 * The questions a business should answer, from the two sources that actually know.
 *
 * Every competitor version of this mines Reddit, or an autocomplete endpoint, and returns
 * questions somebody somewhere might ask. Both of ours are grounded in this client:
 *
 *   - **Search Console**: questions Google is *already* putting this site in front of. Real
 *     impressions, real positions, this month. Free, because the rows are already fetched.
 *   - **People Also Ask**: what Google itself offers alongside the client's own subject. One
 *     paid query, asked deliberately.
 *
 * The two are kept labelled rather than merged into an undifferentiated list, because they carry
 * different weight. A question with impressions is demand this site is already receiving and has
 * a position attached; a People Also Ask question is demand Google has observed somewhere. A
 * reader deciding what to write next should be able to tell those apart, so `source` travels with
 * every row.
 *
 * Grouping is the same deterministic subject-word key CONTENT-002 uses: two phrasings of one
 * question collapse into one entry with the variants attached, so a single content gap does not
 * arrive as six near-identical suggestions.
 */

export type QuestionSource = 'search-console' | 'people-also-ask'

export interface MinedQuestion {
  /** The phrasing we lead with: the highest-impression one, or the first Google offered. */
  question: string
  source: QuestionSource
  /** Impressions over the Search Console window. Absent for a People Also Ask question. */
  impressions?: number
  /** Average position, when Search Console reported one. */
  position?: number
  /** Other phrasings of the same question, in the order they were seen. */
  variants: string[]
}

export interface MineQuestionsInput {
  /** Rows grouped by the `query` dimension: keys is [query]. Empty when Google is not connected. */
  rows?: SearchAnalyticsRow[]
  /** Questions from a People Also Ask box. Empty when no paid query was made. */
  peopleAlsoAsk?: string[]
  /** How many to return. The list is read and acted on by a person, not by a machine. */
  limit?: number
}

/**
 * Below this, a Search Console question is noise.
 *
 * Lower than the quick-wins floor for the same reason CONTENT-002's is: questions are long-tail by
 * nature, and a threshold tuned for head terms hides exactly the gaps worth writing about.
 */
const MIN_IMPRESSIONS = 10

/** The default cap. More suggestions than anybody acts on between audits is noise with a count. */
export const DEFAULT_QUESTION_LIMIT = 20

/** The deterministic identity of a question: its subject words, sorted. */
const subjectKey = (question: string): string => [...topicWords(question)].sort().join(' ')

export function mineQuestions(input: MineQuestionsInput): MinedQuestion[] {
  const limit = input.limit ?? DEFAULT_QUESTION_LIMIT
  const grouped = new Map<string, MinedQuestion>()

  const add = (entry: MinedQuestion) => {
    const key = subjectKey(entry.question)
    if (!key) return

    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, entry)
      return
    }

    /**
     * A phrasing already seen, so one of the two becomes a variant of the other.
     *
     * Impressions alone decide it, and that turns out to settle the source question too: a People
     * Also Ask question has none, so any measured phrasing of the same subject takes the headline
     * whichever order the two sources are read in. That is the behaviour we want, since one
     * carries real impressions from this site and the other is demand Google observed somewhere.
     *
     * An earlier version also checked the sources explicitly. It was unreachable, because rows
     * are read first, and a mutation test caught it: removing the check changed nothing.
     */
    if ((entry.impressions ?? 0) > (existing.impressions ?? 0)) {
      grouped.set(key, {
        ...entry,
        variants: [...existing.variants, existing.question],
      })
      return
    }

    existing.variants.push(entry.question)
  }

  for (const row of input.rows ?? []) {
    const query = row.keys[0]
    if (!query || row.impressions < MIN_IMPRESSIONS || !isQuestion(query)) continue

    add({
      question: query,
      source: 'search-console',
      impressions: row.impressions,
      position: row.position,
      variants: [],
    })
  }

  for (const question of input.peopleAlsoAsk ?? []) {
    const trimmed = question.trim()
    if (!trimmed) continue

    add({ question: trimmed, source: 'people-also-ask', variants: [] })
  }

  return [...grouped.values()]
    .sort((a, b) => {
      // Impressions first, so the questions this site already appears for lead the list. A People
      // Also Ask question has none, which puts it below every measured one rather than at a
      // random position among them.
      const byImpressions = (b.impressions ?? -1) - (a.impressions ?? -1)
      if (byImpressions !== 0) return byImpressions
      return a.question.localeCompare(b.question)
    })
    .slice(0, limit)
}
