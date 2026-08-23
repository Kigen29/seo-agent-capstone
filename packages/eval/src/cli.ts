import { auditCase, loadDataset } from './dataset.js'
import { checkJudgeIndependence } from './judge.js'
import { aggregate, type CaseResult } from './metrics.js'
import { evaluate } from './run.js'

/**
 * Report the numbers, and exit non-zero when the dataset itself is broken.
 *
 * A label pointing at a page the case does not contain scores as a false negative that no engine
 * change could ever fix, so it would sit in the recall figure forever looking like a defect in the
 * rules. That is worth failing loudly for; a merely poor score is not, because the whole point is
 * to watch it move.
 */
function main(): void {
  const cases = loadDataset()

  const broken = cases.flatMap((golden) =>
    auditCase(golden).map((problem) => `${golden.id}: ${problem}`),
  )
  if (broken.length > 0) {
    console.error('The dataset is inconsistent, so any number computed from it would be wrong:\n')
    for (const problem of broken) console.error(`  ${problem}`)
    process.exitCode = 1
    return
  }

  const results = cases.map(evaluate)
  for (const result of results) report(result)

  const overall = aggregate(results)
  console.log(
    `\nOverall, across ${overall.cases} case(s) and ${overall.truePositives + overall.falsePositives} claim(s):`,
  )
  console.log(`  precision          ${pct(overall.precision)}`)
  console.log(`  recall             ${pct(overall.recall)}`)
  console.log(`  F1                 ${pct(overall.f1)}`)
  console.log(`  hallucination rate ${pct(overall.hallucinationRate)}`)

  const judge = checkJudgeIndependence(process.env.LLM_JUDGE, process.env.LLM_SMART)
  console.log(`\nJudge independence: ${judge.independent ? 'ok' : 'NOT INDEPENDENT'}`)
  console.log(`  ${judge.reason}`)
}

function report(result: CaseResult): void {
  console.log(`\n${result.caseId}`)
  console.log(
    `  matched ${result.truePositives}, unexpected ${result.falsePositives}, missed ${result.falseNegatives}`,
  )
  for (const missed of result.missed) console.log(`  MISSED     ${missed}`)
  for (const extra of result.unexpected) console.log(`  UNEXPECTED ${extra}`)
  for (const ghost of result.hallucinated) console.log(`  INVENTED   ${ghost}`)
}

/** `n/a`, never `0%` or `100%`, when the denominator was zero. The distinction is the whole point. */
const pct = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`

main()
