/**
 * The words that make a search a question, and the words that carry no topic.
 *
 * A data file rather than a regex buried in the evaluator, because this is the part that has to
 * grow. It starts with English and a small Swahili set, which is what the sites we run against
 * actually receive; adding a language is an edit here and nothing else. Every entry is lowercase
 * and compared against whole tokens, so "who" matches "who sells tiles" and not "whose".
 *
 * Keeping the two lists separate matters. A question word tells us the searcher wants an answer;
 * a stop word tells us nothing about the subject. Both are removed before deciding whether a
 * page already covers the question, and only the first decides whether the query is a question
 * at all.
 */

/** Leading or embedded words that mark a query as a question. */
export const QUESTION_WORDS = new Set([
  // English interrogatives
  'how',
  'what',
  'why',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'which',
  'can',
  'could',
  'should',
  'does',
  'do',
  'did',
  'is',
  'are',
  'will',
  // Commercial questions that rarely carry an interrogative but always want an answer
  'cost',
  'costs',
  'price',
  'prices',
  'pricing',
  'much',
  'many',
  'vs',
  'versus',
  // Swahili
  'je',
  'nini',
  'vipi',
  'wapi',
  'lini',
  'nani',
  'gani',
  'bei',
  'gharama',
  'namna',
])

/**
 * Words with no topical content, removed before matching a question against a page.
 *
 * Deliberately short. An aggressive stop list would strip words that are the subject in some
 * market ("near me" is the whole intent of a local search), and a short list that occasionally
 * keeps a dull word costs far less than one that deletes the meaningful one.
 */
export const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'and',
  'or',
  'my',
  'your',
  'me',
  'i',
  'you',
  'it',
  'be',
  'get',
  'best',
  'good',
  'ya',
  'wa',
  'na',
  'kwa',
])

/**
 * Split a query into comparable tokens.
 *
 * Lowercased, punctuation dropped, and a trailing "s" removed so "tiles" and "tile" are the same
 * word. That is the crudest possible stemmer and it is the right one here: the alternative is a
 * stemming library whose rules differ per language and which would turn a deterministic
 * comparison into a dependency's opinion.
 */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
}

/** The tokens that say what a query is about: no question words, no stop words. */
export function topicWords(query: string): string[] {
  return tokenise(query).filter((word) => !QUESTION_WORDS.has(word) && !STOP_WORDS.has(word))
}

/** True when the query is phrased as, or functions as, a question. */
export function isQuestion(query: string): boolean {
  const words = tokenise(query)
  if (words.length < 2) return false

  return words.some((word) => QUESTION_WORDS.has(word))
}
