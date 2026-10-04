interface Deployment {
  id: number
  sha: string
  created_at: string
  production_environment?: boolean
}
interface Status {
  state: string
  environment_url?: string | null
}

/** The latest production report for this origin must succeed and contain the merge. */
export async function confirmsDeployment(
  mergeSha: string,
  siteUrl: string,
  deployments: readonly Deployment[],
  statusOf: (id: number) => Promise<Status | undefined>,
  compare: (base: string, head: string) => Promise<string>,
): Promise<boolean> {
  const origin = new URL(siteUrl).origin
  const latestFirst = [...deployments].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  )
  for (const deployment of latestFirst) {
    if (!deployment.production_environment) continue
    const status = await statusOf(deployment.id)
    if (!status?.environment_url) continue
    try {
      if (new URL(status.environment_url).origin !== origin) continue
    } catch {
      continue
    }
    if (status.state !== 'success') return false
    if (deployment.sha === mergeSha) return true
    // Never fall back to an older success if the latest origin deployment rolled back,
    // diverged, or cannot be compared. Missing evidence must stay inconclusive.
    try {
      const relation = await compare(mergeSha, deployment.sha)
      return relation === 'ahead' || relation === 'identical'
    } catch {
      return false
    }
  }
  return false
}
