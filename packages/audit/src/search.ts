import type { Finding, SearchMetrics } from '@seo/core'
import {
  createGscClient,
  decryptToken,
  defaultWindow,
  evaluateCannibalisation,
  evaluateQuestionGaps,
  evaluateQuickWins,
  refreshAccessToken,
  type GscProperty,
  type OAuthConfig,
  type PageSummary,
  type SearchAnalyticsQuery,
  type SearchAnalyticsRow,
} from '@seo/connectors'
import { oauthCredentials, withTenant, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'

export interface SearchResult {
  findings: Finding[]
  /** True only when Search Console was actually queried and returned. */
  measured: boolean
  /** A coverage note for the content axis, when quick-wins ran. */
  note?: string
  /** Clicks, impressions, CTR and position for the window. Absent when the totals call failed. */
  metrics?: SearchMetrics
}

/**
 * Site totals for the window, from a query with no dimensions.
 *
 * A second call rather than summing the per-query rows we already have, and the difference is not
 * pedantic. Google anonymises long-tail queries, so the rows returned for `dimensions: ['query']`
 * omit a real share of the traffic: summing them understates clicks, often badly. Putting that
 * figure on a dashboard labelled "clicks" would be a quiet misstatement of the kind this product
 * exists to avoid, and a dimensionless query returns the true totals in one row.
 *
 * It costs one extra request against a 50,000-per-day quota, and it is allowed to fail on its own:
 * the quick-wins findings are the valuable half and must not be lost because a totals call errored.
 */
async function siteTotals(
  gsc: { searchAnalytics: (p: string, q: SearchAnalyticsQuery) => Promise<SearchAnalyticsRow[]> },
  property: string,
  window: { startDate: string; endDate: string },
): Promise<SearchMetrics | undefined> {
  try {
    const [totals] = await gsc.searchAnalytics(property, { ...window, dimensions: [], rowLimit: 1 })
    if (!totals) return undefined

    return {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: totals.ctr,
      position: totals.position,
      ...window,
    }
  } catch {
    return undefined
  }
}

/**
 * Rows grouped by query *and* page, which is the only shape that shows self-competition.
 *
 * A second request, because one response cannot be both shapes: grouped by page, a query's
 * average position is per page, and the quick-wins checks need the query's own. It is allowed to
 * fail on its own like the totals call, since a rate limit on this request must not cost the
 * audit the findings the first one already produced.
 *
 * The row limit is well under Google's 25,000 ceiling. Cannibalisation shows up on queries with
 * real impressions, which are the rows Search Console returns first, and a wider request would
 * spend quota on the long tail where a one-impression "conflict" is meaningless anyway.
 */
async function pagedRows(
  gsc: { searchAnalytics: (p: string, q: SearchAnalyticsQuery) => Promise<SearchAnalyticsRow[]> },
  property: string,
  window: { startDate: string; endDate: string },
): Promise<SearchAnalyticsRow[]> {
  try {
    return await gsc.searchAnalytics(property, {
      ...window,
      dimensions: ['query', 'page'],
      rowLimit: 5000,
    })
  } catch {
    return []
  }
}

export interface MeasureSearchOptions {
  tenantId: string
  siteId: string
  siteUrl: string
  /** An explicit Search Console property, if the site has one set. Otherwise we match by host. */
  gscProperty?: string | null
  /**
   * What the crawl found, reduced to titles and H1s.
   *
   * Only the question-gap check needs it, and it needs it to tell a missing page from a page
   * that ranks badly. Empty or absent disables that check rather than guessing, which is why
   * the parameter is optional: the rest of this step is about the property, not the crawl.
   */
  pages?: PageSummary[]
}

export interface SearchDeps {
  /** OAuth config for refreshing the stored token. Undefined disables the whole step. */
  config?: OAuthConfig
  /** Injected so a test can drive the token and Search Console endpoints without the network. */
  fetch?: typeof globalThis.fetch
}

/**
 * Measure quick wins from the tenant's Search Console, if they have connected it.
 *
 * Its own step for the same reasons performance is: the data comes from an API rather than
 * the crawl, it is per-tenant, and "no quick wins" has several honest meanings that must not
 * be collapsed. The tenant may not have connected Google; the connection may have been
 * revoked; the site may not match a verified property; or the property may genuinely have no
 * opportunities. Only the last of those is a fact about the site, and none of them is a
 * problem with the audit, so every one returns cleanly with `measured: false` rather than
 * failing the run.
 *
 * The refresh token is decrypted only here, only in memory, and only to trade it for a
 * short-lived access token immediately before the query (ADR-0003). It is never logged and
 * never leaves this function.
 */
/**
 * Open Search Console for a tenant's site: the stored grant, traded for an access token, pointed
 * at the right property.
 *
 * Extracted because a second caller needed exactly this and nothing else. The keyword-gap route
 * subtracts the queries a site already appears for, which is the correction that makes a
 * third-party gap list usable, and it needs the same four steps and the same honest null when any
 * of them is unavailable.
 *
 * The refresh token is decrypted here, in memory, only to trade it for a short-lived access token
 * immediately before the query (ADR-0003). It is never logged and never leaves this function.
 */
export async function openSearchConsole(
  db: Database,
  options: { tenantId: string; siteUrl: string; gscProperty?: string | null },
  deps: SearchDeps = {},
): Promise<{ gsc: ReturnType<typeof createGscClient>; property: string } | null> {
  if (!deps.config) return null

  const [credential] = await withTenant(db, options.tenantId, (tx) =>
    tx
      .select({ token: oauthCredentials.refreshTokenEncrypted })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.provider, 'google'))
      .limit(1),
  )

  if (!credential) return null

  const refreshToken = decryptToken(credential.token)
  const { accessToken } = await refreshAccessToken(deps.config, refreshToken, deps.fetch)
  const gsc = createGscClient({ accessToken, fetch: deps.fetch })

  const property = options.gscProperty ?? matchProperty(await gsc.listProperties(), options.siteUrl)
  if (!property) return null

  return { gsc, property }
}

/**
 * Every query this site drew impressions for in the window.
 *
 * The truth a third-party keyword index does not have. It is lowercased and deduplicated because
 * the only thing it is used for is a set membership test.
 */
export async function siteQueries(
  db: Database,
  options: { tenantId: string; siteUrl: string; gscProperty?: string | null },
  deps: SearchDeps = {},
): Promise<Set<string> | null> {
  try {
    const open = await openSearchConsole(db, options, deps)
    if (!open) return null

    const rows = await open.gsc.searchAnalytics(open.property, {
      ...defaultWindow(),
      dimensions: ['query'],
      rowLimit: 5000,
    })

    return new Set(
      rows
        .map((row) => row.keys[0]?.trim().toLowerCase())
        .filter((query): query is string => Boolean(query)),
    )
  } catch {
    // Revoked credentials, a rate limit, a property that stopped matching: none of these should
    // fail the caller. Null means "not subtracted", which the caller has to say out loud rather
    // than pass off as a clean gap.
    return null
  }
}

export async function measureSearch(
  db: Database,
  options: MeasureSearchOptions,
  deps: SearchDeps = {},
): Promise<SearchResult> {
  try {
    const open = await openSearchConsole(db, options, deps)
    if (!open) return { findings: [], measured: false }

    const { gsc, property } = open
    const window = defaultWindow()
    const rows = await gsc.searchAnalytics(property, {
      ...window,
      dimensions: ['query'],
      rowLimit: 1000,
    })

    const shared = { siteId: options.siteId, siteUrl: options.siteUrl, ...window }

    const findings = [
      ...evaluateQuickWins({ ...shared, rows }),
      ...evaluateQuestionGaps({ ...shared, rows, pages: options.pages ?? [] }),
      ...evaluateCannibalisation({
        ...shared,
        rows: await pagedRows(gsc, property, window),
      }),
    ]

    return {
      findings,
      measured: true,
      metrics: await siteTotals(gsc, property, window),
      note:
        `Search Console included, from real search performance over the 28 days from ` +
        `${window.startDate} to ${window.endDate}: quick wins, pages competing for the same ` +
        `query, and questions the site is shown for but has no page answering. Search Console ` +
        `lags two to three days, so a change will not show here for a few weeks.`,
    }
  } catch {
    // Revoked or expired credentials, a GSC error, a rate limit: none of these is worth
    // failing the audit over. The other axes are real; this one is quietly unmeasured.
    return { findings: [], measured: false }
  }
}

/**
 * Find the verified Search Console property that matches a site's host.
 *
 * A site tracked as `https://example.com` is registered in Search Console as either
 * `sc-domain:example.com` or a URL-prefix property like `https://example.com/`, and the two
 * are not interchangeable. We match on host and accept either shape, and we skip a property
 * the tenant has not actually verified, because querying one returns a permission error, not
 * data.
 */
function matchProperty(properties: GscProperty[], siteUrl: string): string | undefined {
  let host: string
  try {
    host = new URL(siteUrl).host
  } catch {
    return undefined
  }

  const verified = properties.filter((p) => p.permissionLevel !== 'siteUnverifiedUser')

  const domainProperty = verified.find((p) => p.siteUrl === `sc-domain:${host}`)
  if (domainProperty) return domainProperty.siteUrl

  // A host can have more than one URL-prefix property verified (http and https, or nested
  // path prefixes). Prefer https, then the shortest path, so we land on the canonical root
  // rather than an arbitrary first match.
  const prefixProperties = verified
    .map((p) => {
      try {
        return { property: p.siteUrl, url: new URL(p.siteUrl) }
      } catch {
        return undefined
      }
    })
    .filter((entry): entry is { property: string; url: URL } => entry?.url.host === host)
    .sort((a, b) => {
      if (a.url.protocol !== b.url.protocol) return a.url.protocol === 'https:' ? -1 : 1
      return a.url.pathname.length - b.url.pathname.length
    })

  return prefixProperties[0]?.property
}
