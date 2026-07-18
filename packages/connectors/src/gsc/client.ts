import type { GscProperty, SearchAnalyticsQuery, SearchAnalyticsRow } from './types.js'

const BASE = 'https://www.googleapis.com/webmasters/v3'

/** GSC's hard ceiling on rows per request. Asking for more is rejected by the API. */
export const MAX_ROWS_PER_REQUEST = 25_000

/** Thrown on a 429 so a caller can back off rather than treat it as no data. */
export class GscRateLimitError extends Error {
  constructor() {
    super('Search Console rate limit exceeded.')
    this.name = 'GscRateLimitError'
  }
}

/** Thrown on a 401/403 so a caller can prompt the tenant to re-consent rather than retry. */
export class GscAuthError extends Error {
  constructor(status: number) {
    super(`Search Console rejected the credentials (${status}). The tenant may need to re-consent.`)
    this.name = 'GscAuthError'
  }
}

export interface GscClientOptions {
  /** A fresh access token, obtained by refreshing the tenant's stored refresh token. */
  accessToken: string
  fetch?: typeof globalThis.fetch
}

/**
 * The Search Console client. Reads the two things the product needs: which properties the
 * tenant has verified, and the search performance of one of them.
 *
 * It is handed a ready access token rather than a refresh token, so it knows nothing about
 * OAuth: getting a live token from stored credentials is the caller's job (see oauth.ts).
 * That keeps the thing that reads search data separate from the thing that manages consent.
 *
 * Data here lags two to three days: Search Console does not report today or yesterday. A
 * caller asking for "up to today" gets mostly-empty recent rows, so the sensible window ends
 * a few days back, and callers should say so to the user rather than present a dip that is
 * just the reporting lag.
 */
export function createGscClient(options: GscClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const response = await doFetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${options.accessToken}`,
        'content-type': 'application/json',
      },
    })

    if (response.status === 429) throw new GscRateLimitError()
    if (response.status === 401 || response.status === 403) throw new GscAuthError(response.status)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Search Console request failed: ${response.status} ${body.slice(0, 200)}`)
    }

    // A 204 (as `sites.add` returns) carries no body; parsing it as JSON would throw.
    if (response.status === 204) return undefined as T

    return response.json() as Promise<T>
  }

  return {
    /** The properties this tenant can read. Only verified ones are usable. */
    async listProperties(): Promise<GscProperty[]> {
      const data = await call<{ siteEntry?: GscProperty[] }>('/sites', { method: 'GET' })
      return data.siteEntry ?? []
    },

    /**
     * Add a property to the tenant's Search Console (`sites.add`). This is step one of the
     * auto-verification flow: the property has to exist before it can be verified, and it stays
     * unverified until the meta tag is live and Site Verification confirms it. `siteUrl` is the
     * URL-prefix form, e.g. `https://example.com/`, since META verification is a URL-prefix
     * method. Idempotent on Google's side: re-adding a property the tenant already has is fine.
     */
    async addSite(siteUrl: string): Promise<void> {
      await call<void>(`/sites/${encodeURIComponent(siteUrl)}`, { method: 'PUT' })
    },

    /**
     * Query search performance for a property. The property must be URL-encoded in the path;
     * `sc-domain:example.com` and `https://example.com/` both contain characters that break a
     * raw path, and forgetting to encode is the usual cause of a spurious 404.
     */
    async searchAnalytics(
      property: string,
      query: SearchAnalyticsQuery,
    ): Promise<SearchAnalyticsRow[]> {
      const rowLimit = Math.min(query.rowLimit ?? 1000, MAX_ROWS_PER_REQUEST)

      const data = await call<{ rows?: SearchAnalyticsRow[] }>(
        `/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        {
          method: 'POST',
          body: JSON.stringify({
            startDate: query.startDate,
            endDate: query.endDate,
            dimensions: query.dimensions,
            rowLimit,
            startRow: query.startRow ?? 0,
          }),
        },
      )

      // No rows is a valid answer: a real property with no impressions in the window. Not an
      // error, and not something to retry.
      return data.rows ?? []
    },
  }
}

/**
 * A sensible reporting window: the 28 days ending three days ago.
 *
 * Ending three days back rather than today is not a rounding choice, it is the Search Console
 * data lag. Ending "today" would pull in two or three days of near-empty rows that read as a
 * traffic cliff but are only the reporting delay, and that misreading is one of the most
 * common ways a GSC report frightens a client for no reason.
 */
export function defaultWindow(now = new Date()): { startDate: string; endDate: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() - 3)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 28)
  return { startDate: iso(start), endDate: iso(end) }
}
