import { asOwner, type Database } from '@seo/db'
import { AUDIT_QUEUE, QUEUE_SCHEMA } from '@seo/queue'
import { sql } from 'drizzle-orm'

/**
 * Fail every audit whose worker died without saying so.
 *
 * `runAudit` records its own failures, but only failures it lives to see. A runner that is
 * cancelled, times out or loses its machine never reaches that `catch`, so the audit stays on
 * `crawling` and the dashboard shows a progress bar that will never move. pg-boss retries the job
 * (its claim expires after thirty minutes); if every attempt dies the same way, nothing ever tells
 * the audit row.
 *
 * An audit is abandoned only when all of these hold, so a slow crawl is never mistaken for a dead
 * one:
 *
 *   - it is still `queued`, `crawling` or `evaluating`;
 *   - its `started_at` (set when the row is created, and again when a crawl begins) is older
 *     than the grace period, which exceeds the queue's worst case of three thirty-minute attempts;
 *   - pg-boss holds no job for it that is waiting, retrying or running (the audit id is the job
 *     id, see enqueueAudit);
 *   - the outbox holds no unpublished request for it.
 *
 * Nothing is re-queued. A crawl that has died three times is failing for a reason a fourth attempt
 * will not fix; the useful thing is to say so and let the person run it again.
 *
 * Idempotent: the update re-checks the status, so a sweep racing a worker that has just finished
 * changes nothing.
 */
export const ABANDONED_AUDIT_GRACE_MINUTES = 120

const MESSAGE =
  'The worker stopped before this audit finished (the job runner was cancelled, timed out or ' +
  'crashed), so nothing was scored. Run the audit again.'

export async function failAbandonedAudits(
  db: Database,
  graceMinutes = ABANDONED_AUDIT_GRACE_MINUTES,
): Promise<number> {
  // asOwner: a sweep across every tenant, with no request and no tenant of its own.
  const failed = await asOwner(db, (tx) =>
    tx.execute<{ id: string }>(sql`
      update audits a
         set status = 'failed', completed_at = now(), error = ${MESSAGE}
       where a.status in ('queued', 'crawling', 'evaluating')
         and a.started_at < now() - make_interval(mins => ${graceMinutes})
         and not exists (
           select 1 from ${sql.identifier(QUEUE_SCHEMA)}.job j
            where j.name = ${AUDIT_QUEUE}
              and j.id = a.id
              and j.state in ('created', 'retry', 'active'))
         and not exists (
           select 1 from job_outbox o
            where o.event_key = 'audit:' || a.id::text
              and o.published_at is null)
      returning a.id`),
  )
  return failed.rows.length
}
