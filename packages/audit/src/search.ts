import type { Finding } from '@seo/core'
import {
  createGscClient,
  decryptToken,
  defaultWindow,
  evaluateQuickWins,
  refreshAccessToken,
  type GscProperty,
  type OAuthConfig,
} from '@seo/connectors'
import { oauthCredentials, withTenant, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'

export interface SearchResult {
  findings: Finding[]
  /** True only when Search Console was actually queried and returned. */
  measured: boolean
  /** A coverage note for the content axis, when quick-wins ran. */
  note?: string
}

export interface MeasureSearchOptions {
  tenantId: string
  siteId: string
  siteUrl: string
  /** An explicit Search Console property, if the site has one set. Otherwise we match by host. */
  gscProperty?: string | null
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
export async function measureSearch(
  db: Database,
  options: MeasureSearchOptions,
  deps: SearchDeps = {},
): Promise<SearchResult> {
  if (!deps.config) return { findings: [], measured: false }

  const [credential] = await withTenant(db, options.tenantId, (tx) =>
    tx
      .select({ token: oauthCredentials.refreshTokenEncrypted })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.provider, 'google'))
      .limit(1),
  )

  if (!credential) return { findings: [], measured: false }

  try {
    const refreshToken = decryptToken(credential.token)
    const { accessToken } = await refreshAccessToken(deps.config, refreshToken, deps.fetch)
    const gsc = createGscClient({ accessToken, fetch: deps.fetch })

    const property =
      options.gscProperty ?? matchProperty(await gsc.listProperties(), options.siteUrl)
    if (!property) return { findings: [], measured: false }

    const window = defaultWindow()
    const rows = await gsc.searchAnalytics(property, {
      ...window,
      dimensions: ['query'],
      rowLimit: 1000,
    })

    const findings = evaluateQuickWins({
      siteId: options.siteId,
      siteUrl: options.siteUrl,
      ...window,
      rows,
    })

    return {
      findings,
      measured: true,
      note:
        `Search Console quick wins included, from real search performance over the 28 days ` +
        `from ${window.startDate} to ${window.endDate}. Search Console lags two to three days, ` +
        `so a change will not show here for a few weeks.`,
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

  const prefixProperty = verified.find((p) => {
    try {
      return new URL(p.siteUrl).host === host
    } catch {
      return false
    }
  })
  return prefixProperty?.siteUrl
}
