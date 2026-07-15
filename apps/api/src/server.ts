import { createQueue, enqueueAudit } from '@seo/queue'
import { buildApp } from './app.js'
import { makeDispatcher } from './dispatch.js'

/**
 * Render sets PORT and expects the process to bind it on 0.0.0.0. Binding to localhost is
 * the single most common reason a container passes its build and then fails its health
 * check forever.
 */
const port = Number(process.env.PORT ?? 4000)
const host = '0.0.0.0'

/**
 * One queue instance for the process, started at boot. `createQueue` runs pg-boss migrations
 * and starts its maintenance, so it is not something to do per request.
 *
 * The dispatcher is composed in here, not in the app: enqueuing means "put it in pg-boss,
 * then nudge the worker to drain now". The app knows only that it calls `enqueue`.
 */
const queue = await createQueue()
const dispatch = makeDispatcher()

const app = await buildApp({
  corsOrigins: process.env.WEB_URL ? [process.env.WEB_URL] : undefined,
  enqueue: async (job) => {
    await enqueueAudit(queue, job)
    await dispatch()
  },
})

try {
  await app.listen({ port, host })
  console.log(`api listening on ${host}:${port}`)
} catch (error) {
  console.error(error)
  await queue.stop({ graceful: false })
  process.exit(1)
}
