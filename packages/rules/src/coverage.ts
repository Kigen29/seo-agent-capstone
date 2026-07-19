import type { Axis } from '@seo/core'
import { AXES, type AxisCoverage } from '@seo/core'
import { ALL_RULES } from './registry.js'

/**
 * Why an axis the deterministic engine cannot reach is unmeasured, in the user's language.
 *
 * These are not apologies, they are the roadmap. An axis is blank because the data source
 * behind it is not connected, and saying which source is missing tells the user exactly
 * what connecting it would buy them. Delete an entry here when rules for that axis land.
 */
const NOT_MEASURED: Partial<Record<Axis, string>> = {
  performance:
    'Not measured. Core Web Vitals come from CrUX field data, which needs the PageSpeed ' +
    'Insights connector. Lighthouse is lab data and cannot measure INP at all, so we will ' +
    'not substitute it for a field score.',
  authority:
    'Not measured. Referring domains and branded mentions need a backlink source. Mentions ' +
    'correlate far more strongly with AI visibility than links do, so both get measured, ' +
    'not just links.',
  local:
    'Not measured. Needs the Google Business Profile connector. Only meaningful for sites ' +
    'with a physical presence.',
}

/**
 * Caveats on axes we do measure, but only partially. An honest score has to state what it
 * did not look at, or the reader will assume it looked at everything.
 */
const THIN_COVERAGE: Partial<Record<Axis, string>> = {
  ai_visibility:
    'Partially measured. We check that AI search crawlers can reach the site, which is the ' +
    'precondition for being cited. We do not yet poll the engines to see whether you ' +
    'actually are cited: that needs the multi-engine citation module.',
  content:
    'Partially measured. Titles, descriptions, headings, and thin or duplicate pages are ' +
    'checked. Originality, freshness, and keyword cannibalisation are not.',
  agent_readiness:
    'Partially measured. We check for llms.txt, the file that helps AI agents navigate the site ' +
    '(and which Google Search ignores). The accessibility tree and Lighthouse Agentic Browsing ' +
    'checks are not built yet.',
}

/**
 * What the deterministic rule engine covers, per axis, derived from the registry rather
 * than hand-maintained. Adding a rule for an unmeasured axis makes it measured with no
 * other change, which is the property that stops this drifting out of date.
 *
 * The thin coverage is deliberately visible. `ai_visibility` runs exactly one check, and
 * a scorecard that showed it as a bare 100 would be claiming we had verified the site was
 * cited in ChatGPT, when all we verified is that robots.txt does not block the crawler.
 * The note says so.
 */
export function ruleCoverage(): Record<Axis, AxisCoverage> {
  const counts = new Map<Axis, number>()
  for (const rule of ALL_RULES) {
    counts.set(rule.axis, (counts.get(rule.axis) ?? 0) + 1)
  }

  const coverage = {} as Record<Axis, AxisCoverage>

  for (const axis of AXES) {
    const checksRun = counts.get(axis) ?? 0
    const note = checksRun === 0 ? NOT_MEASURED[axis] : THIN_COVERAGE[axis]

    coverage[axis] = note === undefined ? { checksRun } : { checksRun, note }
  }

  return coverage
}
