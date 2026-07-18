import { confirmVerification, openVerificationPr } from '@seo/agent'
import {
  createGscClient,
  createSiteVerificationClient,
  decryptToken,
  googleOAuthConfigFromEnv,
  refreshAccessToken,
} from '@seo/connectors'
import { asOwner, oauthCredentials, sites, withTenant, type Database } from '@seo/db'
import { enqueueConfirmVerify, type ConfirmVerifyJob, type Queue, type VerifyJob } from '@seo/queue'
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

  // A PR was opened -> wait for a human to merge it. The tag was already in the repo (a merged
  // PR, or a hand edit) -> skip straight to merged, and the confirmation sweep will verify it.
  const update = result.pr
    ? {
        gscProperty: result.property,
        gscVerificationPrUrl: result.pr.url,
        gscVerificationStatus: 'pr_open' as const,
      }
    : { gscProperty: result.property, gscVerificationStatus: 'merged' as const }

  await withTenant(db, job.tenantId, (tx) =>
    tx.update(sites).set(update).where(eq(sites.id, site.id)),
  )
}

/**
 * Confirm a merged verification with Google, and mark the site verified if it holds.
 *
 * Runs after the PR is merged. Verification only succeeds once the merged tag is actually live
 * on the deployed site, so a `false` here is not a failure, it is "not yet": the tag has not
 * propagated. We throw in that case so the job retries later (with the queue's generous retry
 * policy) rather than marking the site verified on Google's "no". We flip `gscVerified` only on
 * Google's real yes.
 */
export async function runConfirmVerify(db: Database, job: ConfirmVerifyJob): Promise<void> {
  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: sites.id, gscProperty: sites.gscProperty })
      .from(sites)
      .where(eq(sites.id, job.siteId))
      .limit(1)
    return row
  })

  if (!site) throw new Error(`Site ${job.siteId} not found.`)
  if (!site.gscProperty) {
    throw new Error('This site has no Search Console property; run verification first.')
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
  const verification = createSiteVerificationClient({ accessToken })

  const verified = await confirmVerification(site.gscProperty, verification)
  if (!verified) {
    throw new Error(
      'Not verified yet: the merged tag is not live on the site. Will retry after the deploy propagates.',
    )
  }

  await withTenant(db, job.tenantId, (tx) =>
    tx.update(sites).set({ gscVerificationStatus: 'verified' }).where(eq(sites.id, site.id)),
  )
}

/**
 * Re-enqueue a confirmation for every site still awaiting one.
 *
 * A site sits in `merged` until Google confirms the tag is live, which only happens once the
 * merged change is deployed, and a deploy can lag the merge by longer than the confirm job's own
 * retries last. So on every drain the worker re-checks the merged sites; the confirm job's
 * singleton key keeps that from piling up duplicates. A site that never deploys the tag simply
 * stays merged and gets a cheap re-check each run; a verified one drops out of the query.
 * asOwner because this is a system sweep across tenants, not a request.
 */
export async function enqueuePendingConfirmations(db: Database, queue: Queue): Promise<number> {
  const merged = await asOwner(db, (tx) =>
    tx
      .select({ id: sites.id, tenantId: sites.tenantId })
      .from(sites)
      .where(eq(sites.gscVerificationStatus, 'merged')),
  )

  // Enqueue in bounded-concurrency batches: parallel enough that a large backlog does not stall
  // the drain, capped so it does not flood the connection pool. Each enqueue is isolated, so one
  // broken site is logged and skipped rather than aborting the sweep for every site behind it.
  const BATCH = 10
  let enqueued = 0

  for (let i = 0; i < merged.length; i += BATCH) {
    const batch = merged.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map((site) =>
        enqueueConfirmVerify(queue, { tenantId: site.tenantId, siteId: site.id }),
      ),
    )

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        enqueued += 1
      } else {
        console.warn(
          `worker: could not enqueue confirmation for site ${batch[index]!.id}:`,
          result.reason,
        )
      }
    })
  }

  return enqueued
}
