import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createQueue, drainAudits, enqueueAudit, type AuditJob, type Queue } from '../src/index.js'

/**
 * Against a real Postgres, because a queue is only worth anything if it actually persists and
 * actually hands each job to exactly one worker, and neither can be proven against a mock.
 */
const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

const job = (over: Partial<AuditJob> = {}): AuditJob => ({
  auditId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  siteId: crypto.randomUUID(),
  seed: 'https://example.com',
  ...over,
})

describe.skipIf(!shouldRun)('the audit queue', () => {
  let queue: Queue

  beforeAll(async () => {
    queue = await createQueue(url)
  }, 60_000)

  afterAll(async () => {
    // Purge anything this suite left, so a re-run starts clean and a real audit worker never
    // trips over a test job.
    if (queue) {
      await drainAudits(queue, async () => undefined)
      await queue.stop({ graceful: false })
    }
  })

  it('hands an enqueued job to the drain, with its payload intact', async () => {
    const seen: AuditJob[] = []
    const enqueued = job({ seed: 'https://intact.example.com', maxPages: 7 })

    await enqueueAudit(queue, enqueued)
    const result = await drainAudits(queue, async (j) => {
      seen.push(j)
    })

    expect(result).toEqual({ completed: 1, failed: 0 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      auditId: enqueued.auditId,
      seed: 'https://intact.example.com',
      maxPages: 7,
    })
  })

  it('drains every waiting job, not just the first', async () => {
    const ids = [job(), job(), job()]
    for (const j of ids) await enqueueAudit(queue, j)

    const seen: string[] = []
    const result = await drainAudits(queue, async (j) => {
      seen.push(j.auditId)
    })

    expect(result.completed).toBe(3)
    expect(new Set(seen)).toEqual(new Set(ids.map((j) => j.auditId)))
  })

  it('fails a throwing job without taking the rest of the drain down with it', async () => {
    // One bad audit must not strand the others behind it. The drain fails the job (so pg-boss
    // can retry it later) and carries on.
    const good = job()
    const bad = job()
    await enqueueAudit(queue, good)
    await enqueueAudit(queue, bad)

    const completed: string[] = []
    const result = await drainAudits(queue, async (j) => {
      if (j.auditId === bad.auditId) throw new Error('this audit blew up')
      completed.push(j.auditId)
    })

    expect(result.completed).toBe(1)
    expect(result.failed).toBe(1)
    expect(completed).toEqual([good.auditId])
  })

  it('returns nothing to drain once the queue is empty', async () => {
    const result = await drainAudits(queue, async () => undefined)

    expect(result).toEqual({ completed: 0, failed: 0 })
  })

  it('hands a job to only one drain, so two workers cannot run the same audit twice', async () => {
    // The property that makes the queue safe under the worker.yml schedule and a
    // repository_dispatch firing at the same time: a claimed job is invisible to the other
    // claimant. Two drains racing over one job must together process it exactly once.
    const only = job()
    await enqueueAudit(queue, only)

    const runsA: string[] = []
    const runsB: string[] = []

    const [a, b] = await Promise.all([
      drainAudits(queue, async (j) => {
        runsA.push(j.auditId)
      }),
      drainAudits(queue, async (j) => {
        runsB.push(j.auditId)
      }),
    ])

    expect(a.completed + b.completed).toBe(1)
    expect([...runsA, ...runsB]).toEqual([only.auditId])
  })
})
