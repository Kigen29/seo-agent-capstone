import { decryptToken } from '@seo/connectors'
import { hostingConnections, withTenant, type Database } from '@seo/db'
import { createVercelDeploymentLookup } from '@seo/vcs'
import { eq } from 'drizzle-orm'

/** The saved connection cannot be used as it stands. The message is safe to show the customer. */
export class HostingConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostingConnectionError'
  }
}

/**
 * The deployment lookup for one site, built from that site's own saved connection and nothing
 * else. No environment fallback: an operator-wide token would let one customer's fix be confirmed
 * with another account's access (ADR-0028). No connection is a normal state, and verification then
 * relies on GitHub deployment reports alone.
 */
export async function siteHosting(
  db: Database,
  tenantId: string,
  site: { id: string; url: string; repoFullName: string | null },
) {
  const [connection] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(hostingConnections).where(eq(hostingConnections.siteId, site.id)),
  )
  if (!connection) return { revision: null, deploymentLookup: undefined }
  if (
    connection.origin !== new URL(site.url).origin ||
    connection.repoFullName !== site.repoFullName
  )
    throw new HostingConnectionError(
      'This site or its repository changed after its hosting project was connected. Reconnect ' +
        'the hosting project in Settings, Connections.',
    )
  let credential: unknown
  try {
    credential = JSON.parse(decryptToken(connection.tokenEncrypted))
  } catch {
    // Undecryptable (the encryption key was rotated) or not JSON. Never surface the ciphertext.
    credential = null
  }
  if (
    !credential ||
    typeof credential !== 'object' ||
    !('tenantId' in credential) ||
    credential.tenantId !== tenantId ||
    !('siteId' in credential) ||
    credential.siteId !== site.id ||
    !('token' in credential) ||
    typeof credential.token !== 'string'
  )
    throw new HostingConnectionError(
      'The saved hosting credential for this site cannot be used. Reconnect the hosting project ' +
        'in Settings, Connections.',
    )
  return {
    revision: connection.revision,
    deploymentLookup: createVercelDeploymentLookup({
      token: credential.token,
      projectId: connection.projectId,
      ...(connection.teamId ? { teamId: connection.teamId } : {}),
    }),
  }
}
