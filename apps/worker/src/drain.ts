import { runAudit } from '@seo/audit'
import { createDb } from '@seo/db'
import { createQueue, drainAudits, drainVerify } from '@seo/queue'
import { runVerify } from './verify.js'

/**
 * The worker. Claims queued audits, runs each one, and exits when the queue is empty.
 *
 * This is the free worker fleet from ADR-0006: a GitHub Actions runner on a public repo,
 * where minutes are unlimited and Chromium is preinstalled. It is spun up by a
 * repository_dispatch when the API enqueues, and by a 15-minute schedule as a safety net, so
 * a job is never stranded even if a dispatch is missed. The same command drains the queue
 * locally for a demo.
 *
 * Drain-and-exit, not a long-lived daemon, because the runner is ephemeral: it does its work
 * and dies. Durability lives in the queue, not in this process staying up.
 */
const { db, pool } = createDb()
const queue = await createQueue()

console.log('worker: draining the audit queue')

try {
  const result = await drainAudits(queue, async (job) => {
    console.log(`worker: auditing ${job.seed} (audit ${job.auditId})`)

    // runAudit records its own failure on the audit row before rethrowing, so the drain's
    // fail path marks the job for retry while the dashboard already shows the user what broke.
    await runAudit(db, {
      tenantId: job.tenantId,
      siteId: job.siteId,
      auditId: job.auditId,
      seed: job.seed,
      maxPages: job.maxPages,
    })
  })

  console.log(`worker: done. ${result.completed} completed, ${result.failed} failed.`)

  // Then drain any verification-PR jobs. Same runner, same drain-and-exit shape; a failure here
  // (a revoked token, an unreachable repo) fails only its own job.
  console.log('worker: draining the verification queue')
  const verified = await drainVerify(queue, (job) => runVerify(db, job))
  console.log(
    `worker: verification done. ${verified.completed} completed, ${verified.failed} failed.`,
  )
} finally {
  await queue.stop({ graceful: false })
  await pool.end()
}
