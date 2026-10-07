/**
 * Connecting a Vercel account by consent, and finding the project a repository deploys to.
 *
 * The first hosting connection (ADR-0028) asked a person to create a token in Vercel, find a
 * project id and a team id, and paste all three. Every one of those is something Vercel will tell
 * us if asked properly: an integration's consent screen returns a code that is exchanged for a
 * token scoped to what the person approved, and the project that deploys a repository can be
 * looked up by the repository. So the person's whole part becomes one button and one approval.
 *
 * Two functions, both plain HTTP against Vercel's documented API, with an injectable fetch so
 * they are tested without a network. Neither logs a token or a response body.
 */

type Fetch = typeof globalThis.fetch
type RecordValue = Record<string, unknown>

const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export interface VercelIntegration {
  clientId: string
  clientSecret: string
  /** The integration's URL slug, as in `vercel.com/integrations/<slug>`. */
  slug: string
  /** The Redirect URL registered on the integration. Must match exactly at the exchange. */
  redirectUri: string
}

/** Where to send the browser to ask for consent. `state` comes back untouched on the redirect. */
export function vercelConsentUrl(
  integration: Pick<VercelIntegration, 'slug'>,
  state: string,
): string {
  const url = new URL(`https://vercel.com/integrations/${encodeURIComponent(integration.slug)}/new`)
  url.searchParams.set('state', state)
  return url.toString()
}

export interface VercelGrant {
  token: string
  /** The team the person chose on the consent screen, when they chose one. */
  teamId?: string
}

/** Exchange the code from the consent redirect for an access token. Throws on any refusal. */
export async function exchangeVercelCode(
  integration: VercelIntegration,
  code: string,
  fetcher: Fetch = globalThis.fetch,
): Promise<VercelGrant> {
  const response = await fetcher('https://api.vercel.com/v2/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: integration.clientId,
      client_secret: integration.clientSecret,
      code,
      redirect_uri: integration.redirectUri,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Vercel refused the code exchange (${response.status}).`)

  const body = record(await response.json())
  const token = text(body.access_token)
  if (!token) throw new Error('Vercel returned no access token.')
  const teamId = text(body.team_id)
  return { token, ...(teamId ? { teamId } : {}) }
}

export interface VercelProject {
  id: string
  name: string
}

/**
 * The projects in this account or team that deploy the given GitHub repository.
 *
 * Usually one. More than one is real (a monorepo, or a staging project on the same repository),
 * and choosing between them is not something to guess: the caller tries each against the site's
 * own address and keeps the one that actually serves it.
 */
export async function findVercelProjects(
  options: { token: string; teamId?: string; repoFullName: string },
  fetcher: Fetch = globalThis.fetch,
): Promise<VercelProject[]> {
  const url = new URL('https://api.vercel.com/v10/projects')
  url.searchParams.set('repoUrl', `https://github.com/${options.repoFullName}`)
  url.searchParams.set('limit', '50')
  if (options.teamId) url.searchParams.set('teamId', options.teamId)

  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${options.token}`, 'cache-control': 'no-store' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Vercel refused to list projects (${response.status}).`)

  // The endpoint answers with a bare array or with `{ projects }`, depending on the account.
  const body: unknown = await response.json()
  const list = Array.isArray(body) ? body : record(body).projects
  if (!Array.isArray(list)) return []

  const wanted = options.repoFullName.toLowerCase()
  const projects: VercelProject[] = []
  for (const entry of list) {
    const project = record(entry)
    const link = record(project.link)
    const id = text(project.id)
    const name = text(project.name)
    // The filter is Vercel's, but the answer is checked here: a project is only offered when its
    // own record says it is linked to this repository on GitHub.
    const linked = `${text(link.org) ?? ''}/${text(link.repo) ?? ''}`.toLowerCase()
    if (id && name && link.type === 'github' && linked === wanted) projects.push({ id, name })
  }
  return projects
}
