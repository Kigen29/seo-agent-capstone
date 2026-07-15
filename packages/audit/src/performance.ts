import type { AxisCoverage, Finding } from '@seo/core'
import { createCruxClient, evaluateCoreWebVitals, CruxRateLimitError } from '@seo/connectors'

export interface PerformanceResult {
  findings: Finding[]
  /** What to report for the performance axis on the scorecard. */
  coverage: AxisCoverage
}

/**
 * Measure the performance axis from CrUX field data, and be honest about the three different
 * reasons it might come back empty.
 *
 * The whole reason this is its own function rather than three lines in the runner is that
 * "no performance findings" has three completely different meanings, and collapsing them is
 * the exact dishonesty the scorecard exists to prevent:
 *
 *   1. No API key configured. We could measure this, we just were not asked to. The axis is
 *      unmeasured, and the note says how to switch it on.
 *
 *   2. Key present, but CrUX has no data for this origin. The site is too new or too quiet to
 *      appear in the dataset. This is an absence of measurement, NOT a fast site: reporting
 *      it as good would be a lie. The axis stays unmeasured, and the note says why.
 *
 *   3. Key present, data found. Now, and only now, is the axis measured. If every vital is
 *      good it scores 100 with zero findings; otherwise the poor and needs-improvement ones
 *      become findings.
 *
 * A CrUX failure (rate limit, or a Google outage) is deliberately not fatal. The crawl
 * succeeded and the other seven axes are real; downgrading performance to unmeasured for
 * this run is the proportionate response, not throwing away the whole audit.
 */
export async function measurePerformance(
  siteId: string,
  origin: string,
  apiKey: string | undefined,
  fetchImpl?: typeof globalThis.fetch,
): Promise<PerformanceResult> {
  if (!apiKey) {
    return {
      findings: [],
      coverage: {
        checksRun: 0,
        note:
          'Not measured. Core Web Vitals come from CrUX field data, which needs a Chrome UX ' +
          'Report API key (GOOGLE_CRUX_API_KEY). Lighthouse is lab data and cannot measure ' +
          'INP at all, so we will not substitute it for a field score.',
      },
    }
  }

  try {
    const client = createCruxClient({ apiKey, fetch: fetchImpl })
    const lookup = await client.origin(origin)

    if (!lookup.found) {
      return {
        findings: [],
        coverage: {
          checksRun: 0,
          note:
            'Not measured. This origin does not have enough real-user traffic to appear in ' +
            'CrUX field data. That is common for new or low-traffic sites, and it is an ' +
            'absence of data, not a performance problem: we will not guess a score from ' +
            'nothing.',
        },
      }
    }

    /**
     * Count the vitals CrUX actually returned, not the number we know how to check.
     *
     * CrUX does not always report all three. INP in particular needs interaction data an
     * origin may not have accumulated, so a real record can carry LCP and CLS and no INP.
     * Reporting a flat "3 checks" then would overstate the coverage: we would be claiming to
     * have measured a vital the field data never gave us. The scorecard is meant to say
     * exactly what we looked at, so it counts what came back.
     */
    const checksRun = lookup.record.metrics.length

    // A record with no usable vitals is measurement-shaped but empty. Treat it as unmeasured
    // rather than score an axis on nothing, and say which of the two empty cases this is.
    if (checksRun === 0) {
      return {
        findings: [],
        coverage: {
          checksRun: 0,
          note:
            'Not measured. CrUX has a record for this origin but no Core Web Vitals in it yet, ' +
            'which happens while a new origin is still accumulating enough samples.',
        },
      }
    }

    const findings = evaluateCoreWebVitals(siteId, lookup.record)
    const { firstDate, lastDate } = lookup.record.collectionPeriod
    const measured = lookup.record.metrics.map((m) => m.metric.toUpperCase()).join(', ')

    return {
      findings,
      coverage: {
        checksRun,
        note:
          `Measured from CrUX field data at the 75th percentile of real Chrome users, over ` +
          `the 28 days from ${firstDate} to ${lastDate} (${measured}). A fix will not move ` +
          `these numbers for up to 28 days, because the window is rolling.`,
      },
    }
  } catch (error) {
    const why =
      error instanceof CruxRateLimitError
        ? 'CrUX rate-limited this request'
        : 'the CrUX request failed'

    return {
      findings: [],
      coverage: {
        checksRun: 0,
        note: `Not measured this run: ${why}. The rest of the audit is unaffected; try again shortly.`,
      },
    }
  }
}
