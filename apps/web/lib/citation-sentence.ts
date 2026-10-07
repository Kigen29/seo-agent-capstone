import type { CitationWindow } from '@seo/api-client'

/**
 * A competitor's AI citations either side of a change, as a sentence.
 *
 * The one piece of copy on the competitor page that can make the product lie, so it lives here
 * with a test rather than inline in JSX. The story's falsification condition is that the page
 * "claims a competitor's change caused a citation gain, rather than reporting that one followed
 * the other". So this states two counts with their samples, says "before" and "after", and never
 * uses a word that implies a mechanism: no "because", no "led to", no "lift", no percentage change
 * computed from a handful of checks.
 *
 * Every count is "k of N". A side with no checks says so instead of printing "0 of 0", which
 * would read as "not cited" when the truth is "not looked at".
 */
const side = (window: CitationWindow, days: number, when: 'before' | 'after'): string =>
  window.checks === 0
    ? `no checks ran in the ${days} days ${when}`
    : `cited in ${window.cited} of ${window.checks} checks in the ${days} days ${when}`

export function citationSentence(
  before: CitationWindow,
  after: CitationWindow,
  days: number,
  afterComplete: boolean,
): string {
  if (before.checks === 0 && after.checks === 0) {
    return 'No AI visibility checks ran around this date, so there is nothing to set beside it.'
  }

  const sentence = `${side(before, days, 'before')}, and ${side(after, days, 'after')}`
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${afterComplete ? '' : ' so far'}.`
}

/** Said under every comparison, in the same words every time. */
export const COINCIDENCE_NOTE =
  'One followed the other. That is a coincidence in time, not evidence of a cause.'
