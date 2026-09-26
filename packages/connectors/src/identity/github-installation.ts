export interface InstallationAccessOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  fetch?: typeof globalThis.fetch
}

/** A user token must be authorized for the installation; an app token proves nothing here. */
export async function verifyGitHubInstallationAccess(
  code: string,
  installationId: number,
  options: InstallationAccessOptions,
): Promise<boolean> {
  const http = options.fetch ?? globalThis.fetch
  const response = await http('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return false
  const token = (await response.json()) as { access_token?: string }
  if (!token.access_token) return false
  const access = await http(
    `https://api.github.com/user/installations/${installationId}/repositories?per_page=1`,
    {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'rankwright',
      },
      signal: AbortSignal.timeout(10_000),
    },
  )
  return access.ok
}

/**
 * The installations of this App that the signed-in GitHub user can access, or undefined when the
 * code could not be exchanged or GitHub refused the listing.
 *
 * Asked before sending anyone to install the App. Once it is installed, GitHub's install page turns
 * into a "configure" page that drops our signed state on the way back, so a second install attempt
 * always looked cancelled. Called with a user token minted by this App, `/user/installations`
 * returns only this App's installations, and only those the user can reach, which is also the
 * proof of access the binding needs.
 */
export async function listGitHubUserInstallations(
  code: string,
  options: InstallationAccessOptions,
): Promise<number[] | undefined> {
  const http = options.fetch ?? globalThis.fetch
  const response = await http('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return undefined
  const token = (await response.json()) as { access_token?: string }
  if (!token.access_token) return undefined
  const listed = await http('https://api.github.com/user/installations?per_page=100', {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'rankwright',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!listed.ok) return undefined
  const body = (await listed.json()) as { installations?: { id?: unknown }[] }
  return (body.installations ?? [])
    .map((installation) => installation.id)
    .filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0)
}
