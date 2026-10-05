import { applyFixPrOutcome, pullRequestNumberFrom } from '@seo/audit'
import { sites, withTenant } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { RouteDeps } from './options.js'

/**
 * Ask GitHub what became of a pull request, at the moment somebody looks at its finding.
 *
 * A merge reaches us two ways, and on the free tier both can be late. The webhook is delivered
 * once to an API that may be asleep. The reconciler sweeps every waiting pull request, but only
 * when a worker runs, and the scheduled worker is throttled to hours apart. Between them a person
 * could merge a fix, come back to the finding, and be told for hours that the pull request was
 * still open: a real case, on the first fix a new site ever merged.
 *
 * So the third way is the one that cannot be late: when the finding is read while it is waiting
 * on a pull request, look. It is one request to GitHub, bounded, throttled per finding, and it
 * applies the outcome through the same `applyFixPrOutcome` the webhook and the reconciler use, so
 * all three reach the same conclusion and none can double-apply it.
 *
 * Every failure here is swallowed. This is an improvement to a read; if GitHub is slow or the App
 * has lost access, the finding is returned as it stands and the other two paths remain.
 */

/** How long to wait for GitHub before answering with what we already have. */
const LOOKUP_TIMEOUT_MS = 4_000

/** A finding is not asked about more often than this, however often its page is polled. */
const MIN_INTERVAL_MS = 20_000

const lastChecked = new Map<string, number>()

export interface WaitingFinding {
  rowId: string
  siteId: string
  status: string
  prUrl?: string | null | undefined
}

/** Returns true when the finding's record changed, so the caller should read it again. */
export async function refreshWaitingPullRequest(
  { db, options }: RouteDeps,
  tenantId: string,
  finding: WaitingFinding,
  log?: FastifyBaseLogger,
  now: number = Date.now(),
): Promise<boolean> {
  if (finding.status !== 'pr_open' || !finding.prUrl || !options.github) return false

  const number = pullRequestNumberFrom(finding.prUrl)
  if (number === null) return false

  const previous = lastChecked.get(finding.rowId)
  if (previous !== undefined && now - previous < MIN_INTERVAL_MS) return false
  lastChecked.set(finding.rowId, now)
  // Bounded: this map only needs to cover findings being looked at right now.
  if (lastChecked.size > 5_000) lastChecked.clear()

  try {
    const [site] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ repo: sites.repoFullName, installation: sites.githubInstallationId })
        .from(sites)
        .where(eq(sites.id, finding.siteId))
        .limit(1),
    )
    const [owner, name] = (site?.repo ?? '').split('/')
    if (!site?.repo || !site.installation || !owner || !name) return false

    const outcome = await Promise.race([
      (async () => {
        const api = await options.github!.app.apiFor({
          repo: { owner, name },
          installationId: site.installation!,
        })
        return api.getPullRequest(number)
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)),
    ])
    // Null is "could not read it" (gone, or no access, or too slow). Leave the finding alone.
    if (!outcome || (!outcome.merged && !outcome.closed)) return false

    const effect = await applyFixPrOutcome(
      db,
      finding.prUrl,
      outcome,
      { repoFullName: site.repo, installationId: site.installation },
      options.enqueueVerifyFix,
    )
    return effect !== 'unchanged'
  } catch (error) {
    log?.warn({ err: error, findingId: finding.rowId }, 'could not refresh pull request state')
    return false
  }
}

/** For tests: forget what was checked, so the throttle does not leak between cases. */
export function resetPullRequestRefreshThrottle(): void {
  lastChecked.clear()
}
