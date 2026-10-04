import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

interface DeploymentReport {
  id: number
  sha?: string
  production_environment?: boolean
  payload?: { rankwright?: number; origin?: string }
}

/** A repository-authorized pipeline attestation, not an independent hosting probe. */
export async function reportDeployment(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): Promise<number> {
  const { GH_TOKEN: token, GITHUB_REPOSITORY: repository, DEPLOYED_SHA: sha } = env
  const phase = env.DEPLOYMENT_PHASE
  if (!token || !repository || !/^[a-z0-9][a-z0-9-]*\/[a-z0-9_][a-z0-9_.-]*$/i.test(repository)) {
    throw new Error('A GitHub token and owner/repository are required')
  }
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha))
    throw new Error('An exact deployed commit SHA is required')
  if (!['start', 'success', 'failure'].includes(phase ?? ''))
    throw new Error('Invalid deployment phase')
  const url = new URL(env.SITE_ORIGIN ?? '')
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'SITE_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment',
    )
  }
  const origin = url.origin
  const base = `https://api.github.com/repos/${repository}/deployments`
  async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
    const response = await request(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`GitHub deployment request failed (${response.status})`)
    return (await response.json()) as T
  }
  let id: number
  if (phase === 'start') {
    const deployment = await api<DeploymentReport>('', {
      ref: sha,
      auto_merge: false,
      environment: `rankwright:${origin}`,
      production_environment: true,
      transient_environment: false,
      payload: { rankwright: 1, origin },
      description: 'Production deployment reported by the repository pipeline',
    })
    id = deployment.id
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      deployment.sha?.toLowerCase() !== sha.toLowerCase()
    ) {
      throw new Error('GitHub did not create the requested deployment')
    }
  } else {
    if (!/^[1-9]\d*$/.test(env.DEPLOYMENT_ID ?? '')) throw new Error('DEPLOYMENT_ID is required')
    id = Number(env.DEPLOYMENT_ID)
    if (!Number.isSafeInteger(id)) throw new Error('Invalid deployment ID')
    const deployment = await api<DeploymentReport>(`/${id}`)
    if (
      deployment.sha?.toLowerCase() !== sha.toLowerCase() ||
      deployment.production_environment !== true ||
      deployment.payload?.rankwright !== 1 ||
      deployment.payload?.origin !== origin
    ) {
      throw new Error('Deployment does not match this commit and production origin')
    }
    const statuses = await api<{ state?: string; environment_url?: string }[]>(
      `/${id}/statuses?per_page=1`,
    )
    if (statuses[0]?.state !== 'in_progress' || statuses[0]?.environment_url !== origin) {
      throw new Error(
        'Only an in-progress report can be completed; start a new report for retries or rollbacks',
      )
    }
  }
  await api(`/${id}/statuses`, {
    state: phase === 'start' ? 'in_progress' : phase,
    environment_url: origin,
    auto_inactive: false,
    description:
      phase === 'success'
        ? 'Pipeline confirmed production deployment completed'
        : 'Production deployment is not confirmed',
  })
  return id
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reportDeployment(process.env)
    .then((id) => {
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `deployment-id=${id}\n`)
      console.log(`Deployment report: ${id}`)
    })
    .catch(() => {
      // Do not echo provider bodies, user inputs, or credentials into CI logs.
      console.error(
        'Deployment reporting failed. Check phase, origin, SHA, deployment ID, and GitHub deployment permissions.',
      )
      process.exitCode = 1
    })
}
