import { describe, expect, it } from 'vitest'
import { auditCase, loadDataset } from '../src/dataset.js'
import { evaluate } from '../src/run.js'

/**
 * The dataset is checked in, so CI can check it.
 *
 * A broken label is not a broken build in any obvious way: the harness still runs and still prints
 * a number. It just prints a wrong one, permanently, because a label on a page the case does not
 * contain is a false negative no engine change can ever clear. That is the failure worth catching
 * here, rather than in six months when someone asks why recall has a floor.
 */
describe('the golden dataset', () => {
  const cases = loadDataset()

  it('has cases at all, or every number below is vacuous', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it.each(cases.map((golden) => [golden.id, golden] as const))(
    '%s is internally consistent',
    (_id, golden) => {
      expect(auditCase(golden)).toEqual([])
    },
  )

  it.each(cases.map((golden) => [golden.id, golden] as const))(
    '%s runs through the engine without throwing',
    (_id, golden) => {
      // Not an assertion about the score. The engine must survive real-world HTML, which is the
      // one thing a hand-written fixture cannot test: 200KB of a product catalogue with whatever
      // markup a real CMS emitted.
      expect(() => evaluate(golden)).not.toThrow()
    },
  )

  /**
   * The gate. Every disagreement between the engine and these labels has been taken back to the
   * stored bytes and settled, so a new one is news: either a rule has regressed, or a rule has
   * been added or changed and its claims on real pages have not been read yet. Both should stop a
   * merge. When this fails after adding a rule, that is the harness asking for step 4 of the
   * README, not an obstacle: open the pages, decide, and write the label or fix the rule.
   */
  it('makes no claim on any case that a person has not checked', () => {
    for (const golden of cases) {
      expect(evaluate(golden).unexpected, `${golden.id} has unreviewed claims`).toEqual([])
    }
  })

  it('misses only what it is known to miss', () => {
    // TECH-018 does not judge a page with fewer than fifty rendered words, so that a redirect stub
    // or an error page cannot trip a ratio on a handful of words. These five are such pages on a
    // site where the claim is nonetheless true of them. They stay labelled, and stay missed,
    // rather than being unlabelled to make the number round.
    const missed = cases.flatMap((golden) =>
      evaluate(golden).missed.map((entry) => entry.replace('\u0000', ' ')),
    )
    expect(missed.sort()).toEqual([
      'TECH-018 https://www.heartbeestsafaris.com/admin',
      'TECH-018 https://www.heartbeestsafaris.com/contact',
      'TECH-018 https://www.heartbeestsafaris.com/masai-mara',
      'TECH-018 https://www.heartbeestsafaris.com/ngorongoro',
      'TECH-018 https://www.heartbeestsafaris.com/serengeti',
    ])
  })

  it('covers the fifty real pages the story asks for', () => {
    expect(cases.reduce((sum, golden) => sum + golden.pages.length, 0)).toBeGreaterThanOrEqual(50)
  })

  it('never invents a page, on any case', () => {
    // A deterministic rule reporting a URL the crawl never saw would mean it constructed one.
    // Zero is the only acceptable value here and it is worth pinning rather than merely reporting.
    for (const golden of cases) {
      const result = evaluate(golden)
      expect(result.hallucinated, `${golden.id} reported pages that do not exist`).toEqual([])
    }
  })
})
