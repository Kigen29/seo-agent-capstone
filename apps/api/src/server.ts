import { googleOAuthConfigFromEnv } from '@seo/connectors'
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

/**
 * Google OAuth is optional: if the credentials are not set, the connection routes report 503
 * and the rest of the API runs fine. So a missing config is a skipped feature, not a boot
 * failure, which is what lets the app deploy before the OAuth client exists.
 */
const google = (() => {
  try {
    return { config: googleOAuthConfigFromEnv() }
  } catch {
    console.warn('Google OAuth is not configured; the Search Console connection is disabled.')
    return undefined
  }
})()

const app = await buildApp({
  corsOrigins: process.env.WEB_URL ? [process.env.WEB_URL] : undefined,
  webUrl: process.env.WEB_URL,
  google,
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
