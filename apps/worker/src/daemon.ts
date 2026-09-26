import { publishPendingJobs } from './outbox.js'
import { setTimeout as delay } from 'node:timers/promises'
import { nameTopics } from '@seo/agent'
import { runAudit } from '@seo/audit'
import { asOwner, createDb } from '@seo/db'
import { sql } from 'drizzle-orm'
import {
  createQueue,
  drainAudits,
  drainConfirmVerify,
  drainFix,
  drainPollAi,
  drainVerify,
  drainVerifyFix,
  enqueueConfirmVerify,
  enqueueVerifyFix,
} from '@seo/queue'
import { createWorkerLlm } from './llm.js'
import { runFix } from './fix.js'
import { enqueueDuePolls, runPollAi } from './poll.js'
import { failAbandonedAudits } from './abandoned-audits.js'
import { reconcilePullRequests } from './reconcile.js'
import { runVerifyFix } from './verify-fix.js'
import { enqueuePendingConfirmations, runConfirmVerify, runVerify } from './verify.js'

const { db, pool } = createDb()
const queue = await createQueue()
const llm = createWorkerLlm(db)
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true
  })

async function loop(name: string, work: () => Promise<void>, interval: number) {
  while (!stopping) {
    const started = performance.now()
    try {
      await work()
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'worker_loop_failed',
          lane: name,
          error: error instanceof Error ? error.name : 'unknown',
        }),
      )
    }
    console.log(
      JSON.stringify({
        event: 'worker_heartbeat',
        lane: name,
        durationMs: Math.round(performance.now() - started),
      }),
    )
    if (!stopping) await delay(interval)
  }
}

try {
  await Promise.all([
    loop(
      'crawl',
      async () => {
        await drainVerifyFix(queue, (job) => runVerifyFix(db, job), 1)
        if (!stopping)
          await drainAudits(
            queue,
            async (job) => {
              await runAudit(db, {
                ...job,
                concurrency: 2,
                topics: llm,
                nameTopics: (clusters) => nameTopics(llm, job.tenantId, clusters),
              })
            },
            1,
          )
      },
      1_000,
    ),
    loop(
      'interactive',
      async () => {
        await drainFix(queue, (job) => runFix(db, job), 1)
        if (!stopping) await drainVerify(queue, (job) => runVerify(db, job), 1)
        if (!stopping) await drainConfirmVerify(queue, (job) => runConfirmVerify(db, job), 1)
      },
      1_000,
    ),
    loop(
      'outbox',
      async () => {
        await publishPendingJobs(db, queue)
      },
      1_000,
    ),
    loop(
      'scheduled',
      async () => {
        // Only one scheduler owns the sweep even while old and new containers overlap.
        await asOwner(db, async (tx) => {
          const lock = await tx.execute<{ acquired: boolean }>(
            sql`select pg_try_advisory_xact_lock(19287, 2) as acquired`,
          )
          if (!lock.rows[0]?.acquired) return
          await failAbandonedAudits(db)
          await reconcilePullRequests(db, {
            verifyFix: (job) => enqueueVerifyFix(queue, job),
            confirmVerify: (job) => enqueueConfirmVerify(queue, job),
          })
          await enqueuePendingConfirmations(db, queue)
          await enqueueDuePolls(db, queue)
        })
        if (!stopping)
          await drainPollAi(
            queue,
            async (job) => {
              await runPollAi(db, job)
            },
            1,
          )
      },
      60_000,
    ),
  ])
} finally {
  await queue.stop({ graceful: true })
  await pool.end()
}
