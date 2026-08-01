/**
 * The consensus range: the numbers the AI answers agree on, extracted deterministically.
 *
 * This exists because of how AI answers are actually built. The engine writes the answer first,
 * then picks pages that support the sentences it already wrote, so a page that contradicts the
 * consensus is not chosen, however true it is. The research calls consensus agreement the second
 * strongest predictor of a stable citation, after geographic scope. The practical advice that
 * follows is: state the range the answers already agree on, plainly, and layer your own real
 * numbers underneath it. You cannot follow that advice without knowing the range.
 *
 * So we read the range out of the answers we already collected, with a parser. No model is asked
 * what the answers agreed on: that would be an LLM summarising an LLM, and unfalsifiable
 * (ADR-0001). A regular expression over currency amounts is dull and reproducible, which is the
 * point.
 *
 * Scope is deliberately narrow: **currency amounts only**. A general number extractor would sweep
 * up years, percentages, list positions, group sizes, and distances, and average them into a
 * meaningless pair of numbers. Price is also the question this actually matters for: "how much
 * does X cost" is the query where the consensus range decides who gets cited.
 */

/** The numbers the answers agree on, for one currency. */
export interface ConsensusRange {
  /**
   * The currency label, normalised. `$` is reported as USD, which is an assumption: it could be
   * CAD or AUD. It is a display label on numbers the answers gave, not a claim about which
   * dollar, and callers present it as such.
   */
  currency: string
  /** The typical low end: the median of each answer's lowest figure. */
  low: number
  /** The typical high end: the median of each answer's highest figure. */
  high: number
  /** How many answers contributed a figure in this currency. Never below two. */
  answers: number
}

/**
 * A consensus needs at least two answers to be a consensus. One answer naming a price is that
 * answer's opinion, and reporting it as "what the answers agree on" would be a lie about a
 * sample of one.
 */
const MIN_ANSWERS = 2

const SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
}

const CODES: Record<string, string> = {
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
  jpy: 'JPY',
  kes: 'KES',
  ksh: 'KES',
  zar: 'ZAR',
  ngn: 'NGN',
  inr: 'INR',
  aud: 'AUD',
  cad: 'CAD',
}

/**
 * A currency amount, in the two orders answers actually write them: `$1,200` and `1200 USD`.
 * An optional `k` suffix means thousands, which chat answers use constantly ("around $2k").
 */
const AMOUNT =
  /(?:([$€£¥])\s?([\d,]+(?:\.\d+)?)\s?(k\b)?)|(?:\b([\d,]+(?:\.\d+)?)\s?(k\b)?\s?(usd|eur|gbp|jpy|kes|ksh|zar|ngn|inr|aud|cad)\b)/gi

/** Amounts in one answer, grouped by normalised currency. */
function amountsIn(answer: string): Map<string, number[]> {
  const found = new Map<string, number[]>()

  for (const match of answer.matchAll(AMOUNT)) {
    const [, symbol, symbolValue, symbolK, codeValue, codeK, code] = match

    const currency = symbol ? SYMBOLS[symbol] : CODES[(code ?? '').toLowerCase()]
    const raw = symbol ? symbolValue : codeValue
    const thousands = symbol ? symbolK : codeK
    if (!currency || !raw) continue

    const value = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue

    const scaled = thousands ? value * 1000 : value
    const bucket = found.get(currency)
    if (bucket) bucket.push(scaled)
    else found.set(currency, [scaled])
  }

  return found
}

/**
 * The middle value, leaning low or high on an even count.
 *
 * Averaging the two middles, the usual convention, is wrong here in a way that matters: two
 * answers quoting a flat $3,000 and a flat $4,000 would produce a "consensus" of $3,500 to
 * $3,500, a figure neither answer stated and a range that hides the disagreement. Leaning the
 * low end down and the high end up instead means both endpoints are always figures an answer
 * really gave, and a genuine spread stays visible. On an odd count both lean to the same true
 * median, so the outlier robustness is unaffected. Input is not mutated.
 */
function leaningMedian(values: readonly number[], lean: 'low' | 'high'): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = (sorted.length - 1) / 2
  return sorted[lean === 'low' ? Math.floor(middle) : Math.ceil(middle)]!
}

/**
 * The range the answers agree on, or null when they named no comparable figures.
 *
 * The range is the **median of the answers' low ends to the median of their high ends**, not the
 * outright minimum to the outright maximum. That choice is the whole robustness of the number: one
 * answer mentioning a $50 park fee alongside four answers quoting $2,000 to $4,000 safaris would
 * drag an outright minimum down to $50 and produce a "consensus" no answer actually stated. Taking
 * each answer's own low and high first, then the median across answers, lets a single outlier be
 * outvoted rather than define the range. See {@link leaningMedian} for why the two medians lean
 * outwards on an even count.
 *
 * Null is returned rather than a zeroed range, for the same reason an unmeasured axis carries a
 * null score: no data is not the same as a range of nothing.
 */
export function consensusRange(answers: readonly string[]): ConsensusRange | null {
  const perAnswer = answers.map(amountsIn)

  // The currency the most answers used. Ties break on total figures then alphabetically, so the
  // result never depends on Map insertion order, which would make it depend on answer order.
  const usage = new Map<string, { answers: number; figures: number }>()
  for (const found of perAnswer) {
    for (const [currency, values] of found) {
      const seen = usage.get(currency) ?? { answers: 0, figures: 0 }
      usage.set(currency, { answers: seen.answers + 1, figures: seen.figures + values.length })
    }
  }

  const winner = [...usage.entries()].sort(
    ([aCurrency, a], [bCurrency, b]) =>
      b.answers - a.answers || b.figures - a.figures || aCurrency.localeCompare(bCurrency),
  )[0]

  if (!winner || winner[1].answers < MIN_ANSWERS) return null

  const [currency] = winner
  const contributing = perAnswer
    .map((found) => found.get(currency))
    .filter((values): values is number[] => values !== undefined && values.length > 0)

  return {
    currency,
    low: leaningMedian(
      contributing.map((values) => Math.min(...values)),
      'low',
    ),
    high: leaningMedian(
      contributing.map((values) => Math.max(...values)),
      'high',
    ),
    answers: contributing.length,
  }
}

/** The range as a human sentence, for a finding body. Two identical ends read as one figure. */
export function describeConsensus(range: ConsensusRange): string {
  const amount = (value: number) => `${range.currency} ${value.toLocaleString('en-US')}`
  return range.low === range.high
    ? `${amount(range.low)}, across ${range.answers} answers`
    : `${amount(range.low)} to ${amount(range.high)}, across ${range.answers} answers`
}
