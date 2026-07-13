import { extractPage } from './extract.js'

/**
 * Compare the HTML the server sent against the DOM after JavaScript has run.
 *
 * This is how we catch a client-side-rendered page: one that arrives as an empty
 * <div id="root"> and only becomes a page once the bundle executes. Google does render
 * JavaScript, so this is not automatically fatal, but it is slower, it is fragile, and
 * it is the single most common reason a React or Vue site underperforms in search.
 *
 * Being honest about it matters: this reports "the server sent no content", which is a
 * fact, rather than "Google cannot see your page", which would be false.
 */

export interface RenderComparison {
  preJsWordCount: number
  postJsWordCount: number
  /** Share of the final text that was present before JavaScript ran, 0 to 1. */
  ratio: number
  preJsH1Count: number
  postJsH1Count: number
  likelyCsrOnly: boolean
}

/**
 * Below this share of final content present in the server response, the page is
 * effectively assembled in the browser.
 */
const CSR_RATIO_THRESHOLD = 0.1

/**
 * Pages shorter than this are not judged. A deliberately sparse page (a login screen,
 * a redirect stub) would otherwise trip the ratio test on a handful of words and
 * produce a confident finding about nothing.
 */
const MIN_WORDS_TO_JUDGE = 50

export function compareRenders(
  preJsHtml: string,
  postJsHtml: string,
  url: string,
): RenderComparison {
  const before = extractPage(preJsHtml, url)
  const after = extractPage(postJsHtml, url)

  const ratio = after.wordCount === 0 ? 1 : before.wordCount / after.wordCount

  return {
    preJsWordCount: before.wordCount,
    postJsWordCount: after.wordCount,
    ratio,
    preJsH1Count: before.h1s.length,
    postJsH1Count: after.h1s.length,
    likelyCsrOnly: after.wordCount >= MIN_WORDS_TO_JUDGE && ratio < CSR_RATIO_THRESHOLD,
  }
}
