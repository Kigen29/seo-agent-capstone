export type DeploymentEvidence =
  { status: 'confirmed'; sha: string } | { status: 'unconfirmed' | 'not-found' }

export type DeploymentLookup = (
  siteUrl: string,
  githubRepoId: number,
) => Promise<DeploymentEvidence>

interface VercelOptions {
  token: string
  teamId?: string
  fetch?: typeof globalThis.fetch
}

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}

/** Read current alias pointers, not a historical list of deployments that may have rolled back. */
export function createVercelDeploymentLookup(options: VercelOptions): DeploymentLookup {
  const fetcher = options.fetch ?? globalThis.fetch
  const get = async (path: string): Promise<RecordValue | undefined> => {
    const url = new URL(path, 'https://api.vercel.com')
    if (options.teamId) url.searchParams.set('teamId', options.teamId)
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${options.token}`, 'cache-control': 'no-store' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error('Hosting evidence unavailable')
    return record(await response.json())
  }

  return async (siteUrl, githubRepoId) => {
    try {
      const site = new URL(siteUrl)
      if (site.protocol !== 'https:' || site.port || site.username || site.password)
        return { status: 'unconfirmed' }
      const chain: { host: string; fingerprint: string }[] = []
      let host = site.hostname
      let projectId: string | undefined
      let deploymentId: string | undefined
      const fingerprint = (alias: RecordValue) =>
        JSON.stringify([
          alias.alias,
          alias.projectId,
          alias.deploymentId,
          alias.redirect,
          alias.deletedAt,
          alias.microfrontends,
        ])
      for (let hop = 0; hop < 3; hop++) {
        if (chain.some((entry) => entry.host === host)) return { status: 'unconfirmed' }
        const alias = await get(`/v4/aliases/${encodeURIComponent(host)}`)
        if (!alias) return { status: hop === 0 ? 'not-found' : 'unconfirmed' }
        if (
          alias.alias !== host ||
          alias.deletedAt ||
          alias.microfrontends ||
          typeof alias.projectId !== 'string' ||
          (projectId !== undefined && projectId !== alias.projectId)
        )
          return { status: 'unconfirmed' }
        projectId = alias.projectId
        chain.push({ host, fingerprint: fingerprint(alias) })
        if (alias.redirect) {
          if (typeof alias.redirect !== 'string') return { status: 'unconfirmed' }
          const target = new URL(
            alias.redirect.includes('://') ? alias.redirect : `https://${alias.redirect}`,
          )
          if (
            target.protocol !== 'https:' ||
            target.port ||
            target.username ||
            target.password ||
            target.pathname !== '/' ||
            target.search ||
            target.hash ||
            target.hostname.replace(/^www\./, '') !== site.hostname.replace(/^www\./, '')
          )
            return { status: 'unconfirmed' }
          host = target.hostname
          continue
        }
        if (typeof alias.deploymentId !== 'string') return { status: 'unconfirmed' }
        deploymentId = alias.deploymentId
        break
      }
      if (!deploymentId) return { status: 'unconfirmed' }
      const deployment = await get(`/v13/deployments/${encodeURIComponent(deploymentId)}`)
      const source = record(deployment?.gitSource)
      if (
        !deployment ||
        deployment.id !== deploymentId ||
        deployment.projectId !== projectId ||
        deployment.target !== 'production' ||
        deployment.readyState !== 'READY' ||
        deployment.aliasAssigned !== true ||
        deployment.aliasError ||
        (deployment.readySubstate !== undefined && deployment.readySubstate !== 'PROMOTED') ||
        source.type !== 'github' ||
        String(source.repoId) !== String(githubRepoId) ||
        typeof source.sha !== 'string' ||
        !/^[a-f0-9]{40}$/i.test(source.sha)
      )
        return { status: 'unconfirmed' }
      // Reject an alias promotion/rollback that happened while reading its deployment details.
      for (const entry of chain) {
        const current = await get(`/v4/aliases/${encodeURIComponent(entry.host)}`)
        if (!current || fingerprint(current) !== entry.fingerprint) return { status: 'unconfirmed' }
      }
      return { status: 'confirmed', sha: source.sha }
    } catch {
      // Never include provider bodies, request headers, or credentials in logs/errors.
      return { status: 'unconfirmed' }
    }
  }
}
