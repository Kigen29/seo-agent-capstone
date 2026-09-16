import type { IdentityProvider, IdentityProviderConfig, SocialIdentity } from './types.js'

/**
 * Sign in with GitHub, through the GitHub App we already have.
 *
 * This is the App's user-to-server flow, not a second OAuth application. The credentials are the
 * `GH_APP_CLIENT_ID` and `GH_APP_CLIENT_SECRET` that have been sitting unused in `.env.example`
 * since the App was created, so there is no new identity provider to register, no second consent
 * screen to design, and nothing extra to rotate. `lib/session.ts` predicted exactly this.
 *
 * GitHub Apps ignore the `scope` parameter: what a user-to-server token may do is whatever the
 * App's account permissions say, set once on the App itself. So there is no scope to ask for
 * here, and asking would be misleading rather than merely useless.
 */
const AUTHORIZE = 'https://github.com/login/oauth/authorize'
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'
const EMAILS = 'https://api.github.com/user/emails'

interface GitHubUser {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}

export function createGitHubIdentity(config: IdentityProviderConfig): IdentityProvider {
  const http = config.fetch ?? globalThis.fetch

  return {
    name: 'github',

    authUrl: (state) =>
      `${AUTHORIZE}?${new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        state,
      }).toString()}`,

    async identify(code) {
      const tokenResponse = await http(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
        }),
      })

      if (!tokenResponse.ok) {
        throw new Error(`GitHub token exchange failed: ${tokenResponse.status}`)
      }

      /*
        GitHub answers a rejected code with HTTP 200 and an error in the body.

        Checking `ok` alone would sail past that and then fail further down with an unrelated
        401 from /user, which is a much harder thing to read in a log at the time it matters.
      */
      const token = (await tokenResponse.json()) as { access_token?: string; error?: string }
      if (!token.access_token) {
        throw new Error(`GitHub refused the code: ${token.error ?? 'no access_token returned'}`)
      }

      const headers = {
        authorization: `Bearer ${token.access_token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'rankwright',
      }

      const userResponse = await http(USER, { headers })
      if (!userResponse.ok) throw new Error(`GitHub /user failed: ${userResponse.status}`)
      const user = (await userResponse.json()) as GitHubUser

      return {
        provider: 'github',
        accountId: String(user.id),
        ...(user.name ? { name: user.name } : { name: user.login }),
        ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
        ...((await primaryEmail(http, headers, user)) ?? {}),
      } satisfies SocialIdentity
    },
  }
}

/**
 * The email, if GitHub will tell us, and nothing breaks when it will not.
 *
 * `/user` returns a null email for anyone whose address is private, which is the default for a
 * lot of accounts, and `/user/emails` needs an account permission the App may simply not have
 * been granted. Neither is a failure worth blocking a sign-in over: the email is for display,
 * the account id is the identifier, and a session is perfectly valid without one.
 */
async function primaryEmail(
  http: typeof globalThis.fetch,
  headers: Record<string, string>,
  user: GitHubUser,
): Promise<{ email: string } | undefined> {
  if (user.email) return { email: user.email }

  try {
    const response = await http(EMAILS, { headers })
    if (!response.ok) return undefined

    const emails = (await response.json()) as {
      email: string
      primary: boolean
      verified: boolean
    }[]

    // Verified only. An unverified address proves nothing about who controls it, and showing one
    // as though it did would be the start of a much worse habit.
    const chosen =
      emails.find((row) => row.primary && row.verified) ?? emails.find((r) => r.verified)
    return chosen ? { email: chosen.email } : undefined
  } catch {
    return undefined
  }
}
