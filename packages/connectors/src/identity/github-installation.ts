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
