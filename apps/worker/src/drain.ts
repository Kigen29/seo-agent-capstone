import { runAudit } from '@seo/audit'
import { createDb } from '@seo/db'
import {
  createQueue,
  drainAudits,
  drainConfirmVerify,
  drainFix,
  drainVerify,
  drainVerifyFix,
} from '@seo/queue'
import { runFix } from './fix.js'
import { runVerifyFix } from './verify-fix.js'
import { enqueuePendingConfirmations, runConfirmVerify, runVerify } from './verify.js'

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

  // Then open any pending fix PRs. Same runner, same drain-and-exit shape; a failure here (a
  // revoked token, an unreachable repo, a fixer that cannot locate the source) fails only its
  // own job and is surfaced on the finding rather than taking the drain down.
  console.log('worker: draining the fix queue')
  const fixed = await drainFix(queue, (job) => runFix(db, job))
  console.log(`worker: fixes done. ${fixed.completed} completed, ${fixed.failed} failed.`)

  // Then verify any merged fixes: a re-audit per site, reconciling every finding awaiting
  // verification against the fresh crawl. A crawl failure here fails only its own job.
  console.log('worker: draining the verify-fix queue')
  const verifiedFixes = await drainVerifyFix(queue, (job) => runVerifyFix(db, job))
  console.log(
    `worker: fix verification done. ${verifiedFixes.completed} completed, ${verifiedFixes.failed} failed.`,
  )

  // Then drain any verification-PR jobs. Same runner, same drain-and-exit shape; a failure here
  // (a revoked token, an unreachable repo) fails only its own job.
  console.log('worker: draining the verification queue')
  const verified = await drainVerify(queue, (job) => runVerify(db, job))
  console.log(
    `worker: verification done. ${verified.completed} completed, ${verified.failed} failed.`,
  )

  // Then confirm any merged verifications with Google. A "not yet" (the deploy has not
  // propagated) fails the job so it retries later rather than marking the site verified early.
  // Re-enqueue a check for every site still awaiting confirmation first, so a site whose deploy
  // landed after its earlier confirm gave up is picked back up rather than stranded on merged.
  const pending = await enqueuePendingConfirmations(db, queue)
  console.log(`worker: re-checking ${pending} site(s) awaiting confirmation`)
  const confirmed = await drainConfirmVerify(queue, (job) => runConfirmVerify(db, job))
  console.log(
    `worker: confirmation done. ${confirmed.completed} completed, ${confirmed.failed} failed.`,
  )
} finally {
  await queue.stop({ graceful: false })
  await pool.end()
}
