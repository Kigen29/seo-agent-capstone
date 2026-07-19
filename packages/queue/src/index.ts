import { PgBoss } from 'pg-boss'

/**
 * The job queue, on the same Postgres as everything else.
 *
 * pg-boss, not Redis (ADR-0006, ADR-0007). The queue is a set of tables in a `pgboss` schema
 * in the one database we already have, so there is no second piece of infrastructure to run,
 * pay for, or watch fall over. `DATABASE_URL` is still the entire integration surface.
 *
 * The queue also buys durability, which is the point of enqueuing at all rather than doing
 * the crawl inline: if the API dies after accepting a job, or the worker dies mid-crawl, the
 * job is still in Postgres and a later worker run picks it up. The `repository_dispatch` that
 * spins up a GitHub Actions runner is only a nudge to drain sooner; the schedule in
 * worker.yml drains anyway.
 */

export const AUDIT_QUEUE = 'audit'
export const VERIFY_QUEUE = 'verify'
export const CONFIRM_VERIFY_QUEUE = 'confirm-verify'
export const FIX_QUEUE = 'fix'

/** Kept out of the `public` schema so it never collides with our tables or their RLS. */
const SCHEMA = 'pgboss'

/** What a worker needs to run one audit. Small on purpose: the row already holds the rest. */
export interface AuditJob {
  auditId: string
  tenantId: string
  siteId: string
  seed: string
  maxPages?: number
}

/** What a worker needs to open a Search Console auto-verification PR for a site. */
export interface VerifyJob {
  tenantId: string
  siteId: string
}

/**
 * What a worker needs to confirm a merged verification with Google. Same shape as a VerifyJob,
 * but a distinct type because it is a distinct step: it runs after the PR is merged and the tag
 * is live, and it only reads Google, it does not open anything.
 */
export interface ConfirmVerifyJob {
  tenantId: string
  siteId: string
}

/**
 * What a worker needs to open a pull request that fixes one finding.
 *
 * The finding's row id is the whole payload beyond scope: the worker loads the finding, its
 * evidence, and its site from the row, so the job stays small and can never carry a stale copy
 * of a finding the crawl has since replaced.
 */
export interface FixJob {
  tenantId: string
  siteId: string
  findingRowId: string
}

export type Queue = PgBoss

/**
 * Start pg-boss and make sure the audit queue exists.
 *
 * `start()` creates the pgboss schema on first run and starts its maintenance, so it is not
 * free: callers hold one instance for their lifetime (the API keeps a singleton, the worker
 * starts one, drains, and stops) rather than creating one per request.
 */
export async function createQueue(connectionString = process.env.DATABASE_URL): Promise<Queue> {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. The queue lives in the same Postgres as the data.')
  }

  const boss = new PgBoss({ connectionString, schema: SCHEMA })
  await boss.start()
  await boss.createQueue(AUDIT_QUEUE)
  await boss.createQueue(VERIFY_QUEUE)
  await boss.createQueue(CONFIRM_VERIFY_QUEUE)
  await boss.createQueue(FIX_QUEUE)
  return boss
}

/**
 * Put an audit on the queue.
 *
 * `retryLimit` is deliberately small: a crawl that fails twice is failing for a reason a
 * third attempt will not fix, and the audit runner already records the failure so the user
 * sees it rather than watching a job retry forever. `expireInSeconds` caps a stuck job so a
 * crashed worker's claim is eventually released back to the queue; 30 minutes is comfortably
 * above the longest crawl a capped audit runs.
 */
export async function enqueueAudit(queue: Queue, job: AuditJob): Promise<string | null> {
  return queue.send(AUDIT_QUEUE, job, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 30 * 60,
  })
}

/**
 * Put a verification-PR job on the queue.
 *
 * The same small retry policy as an audit, and for the same reason: opening a PR that fails
 * twice (a revoked token, an unreachable repo) will not succeed on a third try, and the failure
 * is surfaced rather than retried forever.
 */
export async function enqueueVerify(queue: Queue, job: VerifyJob): Promise<string | null> {
  return queue.send(VERIFY_QUEUE, job, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
  })
}

/**
 * Put a confirm-verification job on the queue, after the PR is merged.
 *
 * A more forgiving retry policy than the others on purpose: verification can only succeed once
 * the merged tag is actually deployed and live, and a site's deploy may lag the merge by
 * minutes. So it retries several times with a minute between, which, combined with the worker's
 * schedule, gives a deploy plenty of time to propagate before the job gives up.
 */
export async function enqueueConfirmVerify(
  queue: Queue,
  job: ConfirmVerifyJob,
): Promise<string | null> {
  return queue.send(CONFIRM_VERIFY_QUEUE, job, {
    retryLimit: 5,
    retryDelay: 60,
    expireInSeconds: 30 * 60,
    // One pending confirmation per site. The scheduled worker re-enqueues confirmations for
    // every site still awaiting one, so without this a slow deploy would pile up duplicate jobs.
    singletonKey: job.siteId,
  })
}

/**
 * Put a fix-PR job on the queue.
 *
 * The same small retry policy as verification: opening a PR that fails twice (a revoked token,
 * an unreachable repo, a fixer that cannot locate the source) will not succeed on a third try,
 * and the failure is surfaced on the drain rather than retried forever. `singletonKey` on the
 * finding keeps a double click, or a retried enqueue, from queuing two jobs for one finding;
 * the provider is idempotent per finding besides, so at worst a duplicate is a no-op.
 */
export async function enqueueFix(queue: Queue, job: FixJob): Promise<string | null> {
  return queue.send(FIX_QUEUE, job, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 10 * 60,
    singletonKey: job.findingRowId,
  })
}

/**
 * Drain a queue: run every waiting job, then return.
 *
 * A drain-and-exit loop, not a long-lived subscription, because the worker is a GitHub Actions
 * runner that is spun up, does its work, and dies. The same shape runs locally to empty the
 * queue for a demo.
 *
 * A handler that throws fails the job rather than taking the drain down with it, so one bad job
 * does not strand the others behind it. pg-boss retries a failed job up to its retryLimit on a
 * later drain.
 */
async function drain<T extends object>(
  queue: Queue,
  name: string,
  handler: (job: T) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  let completed = 0
  let failed = 0

  for (;;) {
    const jobs = await queue.fetch<T>(name, { batchSize: 1 })
    if (!jobs || jobs.length === 0) break

    for (const job of jobs) {
      try {
        await handler(job.data)
        await queue.complete(name, job.id)
        completed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await queue.fail(name, job.id, { message })
        failed += 1
      }
    }
  }

  return { completed, failed }
}

/** Drain the audit queue. See {@link drain}. */
export function drainAudits(
  queue: Queue,
  handler: (job: AuditJob) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  return drain(queue, AUDIT_QUEUE, handler)
}

/** Drain the verification queue. See {@link drain}. */
export function drainVerify(
  queue: Queue,
  handler: (job: VerifyJob) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  return drain(queue, VERIFY_QUEUE, handler)
}

/** Drain the confirm-verification queue. See {@link drain}. */
export function drainConfirmVerify(
  queue: Queue,
  handler: (job: ConfirmVerifyJob) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  return drain(queue, CONFIRM_VERIFY_QUEUE, handler)
}

/** Drain the fix queue. See {@link drain}. */
export function drainFix(
  queue: Queue,
  handler: (job: FixJob) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  return drain(queue, FIX_QUEUE, handler)
}
