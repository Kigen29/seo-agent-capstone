import type { IdentityProvider, IdentityProviderConfig, SocialIdentity } from './types.js'

/**
 * Sign in with Google.
 *
 * Deliberately a separate flow from the Search Console consent in `google/oauth.ts`, even though
 * both use the same OAuth client, because the two ask for genuinely different things.
 *
 * That one needs a refresh token, so it must send `access_type=offline` and `prompt=consent`,
 * which forces the full consent screen every single time and exists to buy the right to read
 * Search Console weeks later with nobody present. Signing in needs none of that. It asks for
 * `openid email profile`, takes the id_token, and keeps no token at all afterwards. Reusing the
 * heavier flow would mean re-consenting to Search Console access to log in, which is both
 * annoying and dishonest about what the button does.
 */
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

const SCOPES = ['openid', 'email', 'profile']

interface IdTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

/**
 * Read the claims out of the id_token without verifying its signature.
 *
 * Safe here, and only here, because of where it came from: this token was handed back by
 * Google's own token endpoint over TLS, in response to a request carrying our client secret. Its
 * provenance is not in question, so only its contents are being read. The same shortcut applied
 * to an id_token that arrived from a browser would be a straightforward authentication bypass.
 */
function claimsFromIdToken(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Error('Google returned a malformed id_token.')

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims
}

export function createGoogleIdentity(config: IdentityProviderConfig): IdentityProvider {
  const http = config.fetch ?? globalThis.fetch

  return {
    name: 'google',

    authUrl: (state) =>
      `${AUTHORIZE}?${new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state,
      }).toString()}`,

    async identify(code) {
      const response = await http(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: config.redirectUri,
        }),
      })

      if (!response.ok) {
        throw new Error(`Google token exchange failed: ${response.status}`)
      }

      const body = (await response.json()) as { id_token?: string }
      if (!body.id_token) throw new Error('Google returned no id_token.')

      const claims = claimsFromIdToken(body.id_token)
      if (!claims.sub) throw new Error('Google id_token carried no subject.')

      return {
        provider: 'google',
        accountId: claims.sub,
        // Unverified addresses are dropped rather than shown. Google will hand back an
        // `email_verified: false` for some account types, and displaying one as though it were
        // proven is the start of a habit that ends somewhere expensive.
        ...(claims.email && claims.email_verified !== false ? { email: claims.email } : {}),
        ...(claims.name ? { name: claims.name } : {}),
        ...(claims.picture ? { avatarUrl: claims.picture } : {}),
      } satisfies SocialIdentity
    },
  }
}
