import { openVerificationPr } from '@seo/agent'
import {
  createGscClient,
  createSiteVerificationClient,
  decryptToken,
  googleOAuthConfigFromEnv,
  refreshAccessToken,
} from '@seo/connectors'
import { oauthCredentials, sites, withTenant, type Database } from '@seo/db'
import type { VerifyJob } from '@seo/queue'
import { createGitHubApp, githubAppConfigFromEnv, GitHubProvider } from '@seo/vcs'
import { eq } from 'drizzle-orm'

/**
 * Open a Search Console auto-verification PR for a site.
 *
 * This is the composition root for the killer feature: it resolves the tenant's Google token and
 * the GitHub App into live clients, hands them to the pure orchestration in @seo/agent, and
 * writes back what the dashboard needs. The refresh token is decrypted only here, only in
 * memory, and only to mint a short-lived access token immediately before the calls (ADR-0003).
 *
 * A throw fails the job, which the drain records; a missing repo, a missing Google connection, or
 * a missing App credential each throw a message a human can act on rather than a stack trace.
 */
export async function runVerify(db: Database, job: VerifyJob): Promise<void> {
  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx.select().from(sites).where(eq(sites.id, job.siteId)).limit(1)
    return row
  })

  if (!site) throw new Error(`Site ${job.siteId} not found.`)
  if (!site.repoFullName || !site.githubInstallationId) {
    throw new Error('This site has no connected repository, so there is nowhere to open the PR.')
  }

  const [credential] = await withTenant(db, job.tenantId, (tx) =>
    tx
      .select({ token: oauthCredentials.refreshTokenEncrypted })
      .from(oauthCredentials)
      .where(eq(oauthCredentials.provider, 'google'))
      .limit(1),
  )
  if (!credential) throw new Error('Google is not connected for this tenant.')

  const config = googleOAuthConfigFromEnv()
  const refreshToken = decryptToken(credential.token)
  const { accessToken } = await refreshAccessToken(config, refreshToken)

  const gsc = createGscClient({ accessToken })
  const verification = createSiteVerificationClient({ accessToken })

  const [owner, name] = site.repoFullName.split('/')
  if (!owner || !name) throw new Error(`Malformed connected repo name: ${site.repoFullName}`)

  const provider = new GitHubProvider(createGitHubApp(githubAppConfigFromEnv()).apiFor)
  const repo = { repo: { owner, name }, installationId: site.githubInstallationId }

  const result = await openVerificationPr(
    { siteId: site.id, siteUrl: site.url, repo },
    { property: gsc, verification, provider },
  )

  await withTenant(db, job.tenantId, (tx) =>
    tx
      .update(sites)
      .set({ gscProperty: result.property, gscVerificationPrUrl: result.prUrl })
      .where(eq(sites.id, site.id)),
  )
}
