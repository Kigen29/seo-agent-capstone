import { bandFor, type MetricId } from './thresholds.js'
import type { CruxLookup, CruxMetric } from './types.js'

const ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord'

/** The CrUX metric keys, mapped to our ids. Only these three are Core Web Vitals. */
const METRIC_KEYS: Record<string, MetricId> = {
  largest_contentful_paint: 'lcp',
  interaction_to_next_paint: 'inp',
  cumulative_layout_shift: 'cls',
}

/** Thrown when CrUX rate-limits us, so a caller can back off rather than treat it as no data. */
export class CruxRateLimitError extends Error {
  constructor() {
    super('CrUX rate limit exceeded.')
    this.name = 'CruxRateLimitError'
  }
}

export interface CruxClientOptions {
  apiKey: string
  /** Injected so a contract test can drive the client without touching the network. */
  fetch?: typeof globalThis.fetch
}

/**
 * The CrUX API client. Fetches real-user Core Web Vitals for an origin.
 *
 * This is a client, not a judge: it returns the numbers CrUX reports and the band each falls
 * in, and nothing more. Whether a band is worth a finding, how bad it is, and what to do
 * about it are decisions made deterministically elsewhere (see `evaluate.ts`), so that the
 * thing that talks to the network and the thing that forms an opinion can be tested apart.
 */
export function createCruxClient(options: CruxClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch

  /**
   * Ask CrUX about one origin. `formFactor` left unset asks for all devices combined, which
   * is the honest default headline; a per-device query is a later refinement.
   */
  async function origin(url: string): Promise<CruxLookup> {
    const response = await doFetch(`${ENDPOINT}?key=${options.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Origin-level: the whole site's field data, not one page's. CrUX derives the origin
      // from the URL, so we hand it the origin explicitly rather than a full page URL.
      body: JSON.stringify({ origin: new URL(url).origin }),
    })

    /**
     * 404 is not a failure. It is CrUX saying "this origin does not have enough traffic to
     * appear in the dataset", which is the single most important non-error case here: it is
     * why the performance axis stays honestly unmeasured for small sites instead of being
     * scored on nothing.
     */
    if (response.status === 404) {
      return { found: false, reason: 'no_field_data' }
    }

    if (response.status === 429) throw new CruxRateLimitError()

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`CrUX request failed: ${response.status} ${body.slice(0, 200)}`)
    }

    const data = (await response.json()) as CruxApiResponse

    return { found: true, record: toRecord(url, data) }
  }

  return { origin }
}

interface CruxApiResponse {
  record: {
    key: { origin?: string; url?: string }
    metrics: Record<string, { percentiles?: { p75?: number | string } }>
    collectionPeriod: {
      firstDate: { year: number; month: number; day: number }
      lastDate: { year: number; month: number; day: number }
    }
  }
}

const isoDate = (d: { year: number; month: number; day: number }): string =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

function toRecord(key: string, data: CruxApiResponse) {
  const metrics: CruxMetric[] = []

  for (const [cruxKey, id] of Object.entries(METRIC_KEYS)) {
    const raw = data.record.metrics[cruxKey]?.percentiles?.p75
    if (raw === undefined) continue

    // CLS arrives as a string ("0.09") to preserve precision; LCP and INP as numbers. Coerce
    // uniformly, and skip anything that does not parse rather than let a NaN reach a threshold
    // comparison, where it would silently classify as "not poor" and hide a real problem.
    const p75 = typeof raw === 'string' ? Number(raw) : raw
    if (!Number.isFinite(p75)) continue

    metrics.push({ metric: id, p75, band: bandFor(id, p75) })
  }

  return {
    key,
    collectionPeriod: {
      firstDate: isoDate(data.record.collectionPeriod.firstDate),
      lastDate: isoDate(data.record.collectionPeriod.lastDate),
    },
    metrics,
  }
}
