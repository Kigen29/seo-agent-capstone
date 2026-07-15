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
 * Drain the audit queue: run every waiting job, then return.
 *
 * A drain-and-exit loop, not a long-lived subscription, because the worker is a GitHub
 * Actions runner that is spun up, does its work, and dies. The same shape runs locally to
 * empty the queue for a demo.
 *
 * A handler that throws fails the job rather than taking the drain down with it, so one bad
 * audit does not strand the others behind it. pg-boss will retry a failed job up to its
 * retryLimit on a later drain.
 */
export async function drainAudits(
  queue: Queue,
  handler: (job: AuditJob) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  let completed = 0
  let failed = 0

  for (;;) {
    const jobs = await queue.fetch<AuditJob>(AUDIT_QUEUE, { batchSize: 1 })
    if (!jobs || jobs.length === 0) break

    for (const job of jobs) {
      try {
        await handler(job.data)
        await queue.complete(AUDIT_QUEUE, job.id)
        completed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await queue.fail(AUDIT_QUEUE, job.id, { message })
        failed += 1
      }
    }
  }

  return { completed, failed }
}
