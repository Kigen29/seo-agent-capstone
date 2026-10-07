import { randomUUID } from 'node:crypto'
import { encryptToken } from '@seo/connectors'
import { hostingConnections, sites, withTenant, type Database } from '@seo/db'
import { createVercelDeploymentLookup, findVercelProjects } from '@seo/vcs'
import { eq } from 'drizzle-orm'
import type { AppOptions } from './options.js'

/**
 * Validate a Vercel credential against one site, and store it.
 *
 * Shared by the two ways a credential arrives: pasted into the form, or granted on Vercel's
 * consent screen. Whichever it was, the same three rules of ADR-0028 hold, because they are
 * enforced here and nowhere else. The credential is checked against the site address and
 * repository on our record, never against anything the caller supplied. It is stored encrypted
 * and bound to this tenant and site. And it is never returned.
 */
export interface HostedSite {
  id: string
  url: string
  repoFullName: string
  githubInstallationId: number
}

export interface VercelCredential {
  token: string
  teamId?: string
  /** Omitted when the project should be found from the repository. */
  projectId?: string
}

export type HostingConnectResult =
  /** Stored. */
  | { status: 'connected'; projectId: string }
  /** The account has no project that deploys this repository. */
  | { status: 'no_project' }
  /** A project was found or named, but nothing proves it serves this site from this repository. */
  | { status: 'unconfirmed' }
  /** The site's address or repository changed while this was in flight. */
  | { status: 'changed' }

async function serves(
  options: AppOptions,
  site: HostedSite,
  credential: Required<Pick<VercelCredential, 'token' | 'projectId'>> & { teamId?: string },
): Promise<boolean> {
  const input = {
    ...credential,
    siteUrl: site.url,
    repoFullName: site.repoFullName,
    installationId: site.githubInstallationId,
  }
  try {
    if (options.validateHosting) return await options.validateHosting(input)
    if (!options.github) return false

    const [owner, name] = site.repoFullName.split('/')
    const api = await options.github.app.apiFor({
      repo: { owner: owner!, name: name! },
      installationId: site.githubInstallationId,
    })
    const repoId = await api.getRepositoryId?.()
    if (!repoId) return false
    return (await createVercelDeploymentLookup(input)(site.url, repoId)).status === 'confirmed'
  } catch {
    /* Never log credentials or upstream response bodies. */
    return false
  }
}

export async function connectVercel(
  deps: { db: Database; options: AppOptions },
  tenantId: string,
  site: HostedSite,
  credential: VercelCredential,
): Promise<HostingConnectResult> {
  const { db, options } = deps

  // Candidates: the project that was named, or every project that deploys this repository.
  let candidates: string[]
  if (credential.projectId) {
    candidates = [credential.projectId]
  } else {
    try {
      const found = await (options.findVercelProjects ?? findVercelProjects)(
        {
          token: credential.token,
          repoFullName: site.repoFullName,
          ...(credential.teamId ? { teamId: credential.teamId } : {}),
        },
        options.vercel?.fetch,
      )
      candidates = found.map((project) => project.id)
    } catch {
      candidates = []
    }
    if (candidates.length === 0) return { status: 'no_project' }
  }

  // A repository can deploy to more than one project. The one kept is the one that is proved to
  // serve this site's address, which is the only property that matters to verification.
  let projectId: string | undefined
  for (const candidate of candidates) {
    const confirmed = await serves(options, site, {
      token: credential.token,
      projectId: candidate,
      ...(credential.teamId ? { teamId: credential.teamId } : {}),
    })
    if (confirmed) {
      projectId = candidate
      break
    }
  }
  if (!projectId) return { status: 'unconfirmed' }

  const tokenEncrypted = encryptToken(
    JSON.stringify({ tenantId, siteId: site.id, token: credential.token }),
  )
  const saved = await withTenant(db, tenantId, async (tx) => {
    const [current] = await tx.select().from(sites).where(eq(sites.id, site.id)).for('update')
    if (
      !current ||
      current.url !== site.url ||
      current.repoFullName !== site.repoFullName ||
      current.githubInstallationId !== site.githubInstallationId
    )
      return false
    const value = {
      siteId: site.id,
      tenantId,
      revision: randomUUID(),
      origin: new URL(site.url).origin,
      repoFullName: site.repoFullName,
      projectId: projectId!,
      teamId: credential.teamId ?? null,
      tokenEncrypted,
      validatedAt: new Date(),
    }
    await tx
      .insert(hostingConnections)
      .values(value)
      .onConflictDoUpdate({ target: hostingConnections.siteId, set: value })
    return true
  })

  return saved ? { status: 'connected', projectId } : { status: 'changed' }
}
