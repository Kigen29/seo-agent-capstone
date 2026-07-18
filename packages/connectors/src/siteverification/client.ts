const BASE = 'https://www.googleapis.com/siteVerification/v1'

/**
 * The name of the meta tag Google looks for. The fixer builds
 * `<meta name="google-site-verification" content="{token}">` from the token this client
 * fetches, and Google reads exactly this name when verifying.
 */
export const META_TAG_NAME = 'google-site-verification'

/** Thrown on a 401/403 so a caller can prompt the tenant to re-consent rather than retry. */
export class SiteVerificationAuthError extends Error {
  constructor(status: number) {
    super(
      `Site Verification rejected the credentials (${status}). The tenant may need to re-consent.`,
    )
    this.name = 'SiteVerificationAuthError'
  }
}

export interface SiteVerificationClientOptions {
  /** A fresh access token, obtained by refreshing the tenant's stored refresh token. */
  accessToken: string
  fetch?: typeof globalThis.fetch
}

/**
 * The Site Verification client, which proves the tenant owns a site via a meta tag.
 *
 * This is the other half of the killer feature: Search Console `sites.add` creates the
 * property, and this confirms ownership. Two calls, in order:
 *
 *   getMetaToken -> the value to drop into a `<meta name="google-site-verification">` tag. The
 *   agent opens a PR that adds that tag to the site's head.
 *
 *   verifyMeta   -> asks Google to fetch the site and confirm the tag is there. It is only ever
 *   called after the PR is merged, and it reports verified strictly on Google's success, never
 *   optimistically. A site that does not yet have the tag is a plain `false`, not an error, so a
 *   caller can poll after the merge without treating "not yet" as a failure.
 *
 * Like the GSC client, it is handed a live access token and knows nothing about OAuth.
 */
export function createSiteVerificationClient(options: SiteVerificationClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch

  async function call(path: string, body: unknown): Promise<Response> {
    const response = await doFetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (response.status === 401 || response.status === 403) {
      throw new SiteVerificationAuthError(response.status)
    }
    return response
  }

  const siteResource = (siteUrl: string) => ({ site: { type: 'SITE', identifier: siteUrl } })

  return {
    /**
     * Get the meta-tag token for a URL-prefix site. The returned value is the `content` of the
     * `<meta name="google-site-verification">` tag, nothing more; the fixer wraps it in the tag.
     */
    async getMetaToken(siteUrl: string): Promise<string> {
      const response = await call('/token', {
        ...siteResource(siteUrl),
        verificationMethod: 'META',
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `Could not get a verification token: ${response.status} ${text.slice(0, 200)}`,
        )
      }

      const data = (await response.json()) as { token?: string }
      if (!data.token) throw new Error('Site Verification returned no token.')
      return data.token
    },

    /**
     * Ask Google to verify ownership by fetching the site and checking for the meta tag. Returns
     * true only if Google confirms it. A 400 (the usual "tag not found yet") is a `false`, so a
     * caller can call this after a merge and poll rather than crash. Other non-OK statuses are
     * real errors and throw.
     */
    async verifyMeta(siteUrl: string): Promise<boolean> {
      const response = await call('/webResource?verificationMethod=META', siteResource(siteUrl))

      if (response.ok) return true
      // 400 means Google fetched the site and did not find the tag. That is "not yet verified",
      // the normal state before the PR is merged and deployed, not an error to throw over.
      if (response.status === 400) return false

      const text = await response.text().catch(() => '')
      throw new Error(`Verification failed: ${response.status} ${text.slice(0, 200)}`)
    },
  }
}
