import { confirmVerification, openVerificationPr, VerificationInjectionError } from '@seo/agent'
import { googleAccessToken, GoogleNotConnectedError, matchProperty } from '@seo/audit'
import {
  createGscClient,
  createSiteVerificationClient,
  googleOAuthConfigFromEnv,
  GoogleReauthRequiredError,
} from '@seo/connectors'
import { asOwner, sites, withTenant, type Database } from '@seo/db'
import { enqueueConfirmVerify, type ConfirmVerifyJob, type Queue, type VerifyJob } from '@seo/queue'
import {
  createGitHubApp,
  githubAppConfigFromEnv,
  GitHubProvider,
  type VersionControlProvider,
} from '@seo/vcs'
import { eq } from 'drizzle-orm'

/** Injected by tests, in place of Google and GitHub. */
export interface VerifyDeps {
  accessToken?: (db: Database, tenantId: string) => Promise<string>
  gsc?: (
    accessToken: string,
  ) => Pick<ReturnType<typeof createGscClient>, 'listProperties' | 'addSite'>
  open?: typeof openVerificationPr
  /** Where the pull request is opened. Built from the GitHub App when not given. */
  provider?: VersionControlProvider
}

/**
 * Why a verification attempt failed, in words that can be shown to the person who asked for it.
 *
 * Never the provider's own text. Google's and GitHub's error bodies can carry tokens, repository
 * contents and internal detail, and none of that belongs on a settings page. Each case here says
 * what happened and what the person can do about it; the last says that there is nothing they
 * can do, which is also worth knowing.
 */
export function verificationFailure(error: unknown): string {
  if (error instanceof GoogleReauthRequiredError) {
    return 'Google rejected the saved sign-in, so nothing could be done with it. Connect Google again, then verify.'
  }
  if (error instanceof GoogleNotConnectedError) {
    return 'Google is not connected. Connect Search Console, then verify.'
  }
  if (error instanceof VerificationInjectionError) {
    return 'The agent could not find where the page head is written in this repository, so it could not add the tag. Verify the site in Search Console directly, and it will be picked up from there.'
  }
  if (error instanceof NoRepositoryError) return error.message
  return 'The verification pull request could not be opened. It is tried again automatically. If this message is still here tomorrow, the fault is on our side.'
}

class NoRepositoryError extends Error {
  constructor() {
    super('This site has no connected repository, so there is nowhere to open the pull request.')
    this.name = 'NoRepositoryError'
  }
}

/**
 * Verify a site's Search Console property, by pull request only if one is needed.
 *
 * This is the composition root for the feature: it resolves the tenant's Google token and the
 * GitHub App into live clients, hands them to the pure orchestration in @seo/agent, and writes
 * back what the dashboard needs. The refresh token is decrypted only in memory, and only to mint
 * a short-lived access token immediately before the calls (ADR-0003).
 *
 * Two things it did not do, and now does (ADR-0048):
 *
 *   - **It looks first.** If the connected Google account already has a verified property for
 *     this site, there is nothing to prove. The site is marked verified and no pull request is
 *     opened. Asking somebody to merge a pull request to prove something Google already knows
 *     was the product making work.
 *   - **It says when it failed.** A throw still fails the job, which the queue retries. But the
 *     reason is first written to the site, so the person who pressed the button is told.
 */
export async function runVerify(
  db: Database,
  job: VerifyJob,
  deps: VerifyDeps = {},
): Promise<void> {
  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx.select().from(sites).where(eq(sites.id, job.siteId)).limit(1)
    return row
  })

  if (!site) throw new Error(`Site ${job.siteId} not found.`)
  // A delayed or replayed delivery must not open a second PR or move a verified site backwards.
  if (site.gscVerificationStatus !== 'none') return

  const save = (update: Partial<typeof sites.$inferInsert>) =>
    withTenant(db, job.tenantId, (tx) => tx.update(sites).set(update).where(eq(sites.id, site.id)))

  try {
    const accessToken = await (deps.accessToken
      ? deps.accessToken(db, job.tenantId)
      : googleAccessToken(db, job.tenantId, googleOAuthConfigFromEnv()))
    const gsc = deps.gsc ? deps.gsc(accessToken) : createGscClient({ accessToken })

    // Already verified in this Google account: nothing to open, nothing to merge.
    const existing = matchProperty(await gsc.listProperties(), site.url)
    if (existing) {
      await save({
        gscProperty: existing,
        gscVerificationStatus: 'verified',
        gscVerificationError: null,
      })
      return
    }

    if (!site.repoFullName || !site.githubInstallationId) throw new NoRepositoryError()
    const [owner, name] = site.repoFullName.split('/')
    if (!owner || !name) throw new Error(`Malformed connected repo name: ${site.repoFullName}`)

    const repo = { repo: { owner, name }, installationId: site.githubInstallationId }
    const result = await (deps.open ?? openVerificationPr)(
      { siteId: site.id, siteUrl: site.url, repo },
      {
        property: gsc,
        verification: createSiteVerificationClient({ accessToken }),
        provider:
          deps.provider ?? new GitHubProvider(createGitHubApp(githubAppConfigFromEnv()).apiFor),
      },
    )

    // A PR was opened -> wait for a human to merge it. The tag was already in the repo (a merged
    // PR, or a hand edit) -> skip straight to merged, and the confirmation sweep will verify it.
    await save(
      result.pr
        ? {
            gscProperty: result.property,
            gscVerificationPrUrl: result.pr.url,
            gscVerificationStatus: 'pr_open',
            gscVerificationError: null,
          }
        : {
            gscProperty: result.property,
            gscVerificationStatus: 'merged',
            gscVerificationError: null,
          },
    )
  } catch (error) {
    // Told to the person first, then to the queue. Writing it must not hide the original error.
    await save({ gscVerificationError: verificationFailure(error) }).catch(() => {})
    throw error
  }
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

  let accessToken: string
  try {
    accessToken = await googleAccessToken(db, job.tenantId, googleOAuthConfigFromEnv())
  } catch (error) {
    // The tag may be merged and live, and Google will still not confirm it for a dead grant.
    if (error instanceof GoogleReauthRequiredError || error instanceof GoogleNotConnectedError) {
      await withTenant(db, job.tenantId, (tx) =>
        tx
          .update(sites)
          .set({ gscVerificationError: verificationFailure(error) })
          .where(eq(sites.id, site.id)),
      )
    }
    throw error
  }
  const verification = createSiteVerificationClient({ accessToken })

  const verified = await confirmVerification(site.gscProperty, verification)
  if (!verified) {
    throw new Error(
      'Not verified yet: the merged tag is not live on the site. Will retry after the deploy propagates.',
    )
  }

  await withTenant(db, job.tenantId, (tx) =>
    tx
      .update(sites)
      .set({ gscVerificationStatus: 'verified', gscVerificationError: null })
      .where(eq(sites.id, site.id)),
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
