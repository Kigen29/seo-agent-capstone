import type { Band, MetricId } from './thresholds.js'

/** One Core Web Vital, as CrUX reports it: the p75 of real users, and its band. */
export interface CruxMetric {
  metric: MetricId
  p75: number
  band: Band
}

/**
 * A CrUX field-data record for one origin (or URL).
 *
 * `collectionPeriod` is carried, not discarded, because it is the honest answer to "how
 * fresh is this?": CrUX is a rolling 28-day window, so this is data about the last 28 days
 * of real users, not this moment. Any claim we make about performance is a claim about that
 * window.
 */
export interface CruxRecord {
  /** The origin or URL this record describes. */
  key: string
  /** ISO dates bounding the 28-day window this data covers. */
  collectionPeriod: { firstDate: string; lastDate: string }
  metrics: CruxMetric[]
}

/**
 * The result of asking CrUX about an origin.
 *
 * `null` is a first-class answer and not an error. CrUX only has data for origins with
 * enough real-user traffic, so a new or quiet site returns nothing. That is an absence of
 * measurement, not a performance problem, and the two must never be confused: reporting a
 * site with no field data as "fast" would be a lie, and reporting it as "slow" would be a
 * different lie.
 */
export type CruxLookup =
  { found: true; record: CruxRecord } | { found: false; reason: 'no_field_data' }
