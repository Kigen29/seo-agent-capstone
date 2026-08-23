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

  it('never invents a page, on any case', () => {
    // A deterministic rule reporting a URL the crawl never saw would mean it constructed one.
    // Zero is the only acceptable value here and it is worth pinning rather than merely reporting.
    for (const golden of cases) {
      const result = evaluate(golden)
      expect(result.hallucinated, `${golden.id} reported pages that do not exist`).toEqual([])
    }
  })
})
