import {
  decryptToken,
  GoogleReauthRequiredError,
  refreshAccessToken,
  type GscProperty,
  type OAuthConfig,
} from '@seo/connectors'
import { oauthCredentials, withTenant, type Database } from '@seo/db'
import { and, eq } from 'drizzle-orm'

/**
 * Getting a Google access token for a tenant, and noticing when Google will no longer give one.
 *
 * Every caller did this by hand: read the stored refresh token, decrypt it, trade it for an
 * access token. And every caller treated a refusal as its own error, to log or swallow. So a
 * connection Google had rejected kept its row in the database and went on being reported as
 * "connected", while the audit quietly measured nothing from Search Console and a verification
 * request failed in a worker log (ADR-0048).
 *
 * This is the one place a refusal is recorded, so the connection can say it needs connecting
 * again, and the one place that record is cleared when a token is granted.
 */

/** No Google account is connected for this tenant. */
export class GoogleNotConnectedError extends Error {
  constructor() {
    super('Google is not connected for this tenant.')
    this.name = 'GoogleNotConnectedError'
  }
}

export async function googleAccessToken(
  db: Database,
  tenantId: string,
  config: OAuthConfig,
  fetchImpl?: typeof globalThis.fetch,
): Promise<string> {
  const [credential] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        token: oauthCredentials.refreshTokenEncrypted,
        needsReconnectAt: oauthCredentials.needsReconnectAt,
      })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.provider, 'google'))
      .limit(1),
  )
  if (!credential) throw new GoogleNotConnectedError()

  const mark = (needsReconnectAt: Date | null) =>
    withTenant(db, tenantId, (tx) =>
      tx
        .update(oauthCredentials)
        .set({ needsReconnectAt })
        .where(
          and(eq(oauthCredentials.tenantId, tenantId), eq(oauthCredentials.provider, 'google')),
        ),
    )

  try {
    const { accessToken } = await refreshAccessToken(
      config,
      decryptToken(credential.token),
      fetchImpl,
    )
    // Google gave one, so whatever was wrong is not wrong now.
    if (credential.needsReconnectAt) await mark(null)
    return accessToken
  } catch (error) {
    // Only a refusal of the grant itself. A timeout or a 500 says nothing about the connection.
    if (error instanceof GoogleReauthRequiredError && !credential.needsReconnectAt) {
      await mark(new Date())
    }
    throw error
  }
}

/** A site's host and its `www.` twin: one site, whichever the owner happened to type. */
function hostsOf(siteUrl: string): string[] | undefined {
  try {
    const host = new URL(siteUrl).host
    const bare = host.replace(/^www\./, '')
    return [bare, `www.${bare}`]
  } catch {
    return undefined
  }
}

/**
 * The verified Search Console property that covers a site, if the account has one.
 *
 * A domain property covers every host under the domain, so it is preferred. Otherwise a
 * URL-prefix property on the site's host, https before http and the shortest path first, so the
 * answer is the canonical root and not an arbitrary first match.
 *
 * `www.example.com` and `example.com` are treated as one site. They used to have to match
 * exactly, and a site added without `www.` whose property was verified with it (the common case,
 * since most sites redirect one to the other) was reported as having no property at all.
 */
export function matchProperty(properties: GscProperty[], siteUrl: string): string | undefined {
  const hosts = hostsOf(siteUrl)
  if (!hosts) return undefined

  const verified = properties.filter((p) => p.permissionLevel !== 'siteUnverifiedUser')

  const domainProperty = verified.find((p) => p.siteUrl === `sc-domain:${hosts[0]}`)
  if (domainProperty) return domainProperty.siteUrl

  const requested = new URL(siteUrl).host
  const prefixProperties = verified
    .map((p) => {
      try {
        return { property: p.siteUrl, url: new URL(p.siteUrl) }
      } catch {
        return undefined
      }
    })
    .filter(
      (entry): entry is { property: string; url: URL } =>
        entry !== undefined && hosts.includes(entry.url.host),
    )
    .sort((a, b) => {
      // The host as it was typed, before its twin.
      if ((a.url.host === requested) !== (b.url.host === requested)) {
        return a.url.host === requested ? -1 : 1
      }
      if (a.url.protocol !== b.url.protocol) return a.url.protocol === 'https:' ? -1 : 1
      return a.url.pathname.length - b.url.pathname.length
    })

  return prefixProperties[0]?.property
}
