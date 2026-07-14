import { buildApp } from './app.js'

/**
 * Render sets PORT and expects the process to bind it on 0.0.0.0. Binding to localhost is
 * the single most common reason a container passes its build and then fails its health
 * check forever.
 */
const port = Number(process.env.PORT ?? 4000)
const host = '0.0.0.0'

const app = await buildApp({
  corsOrigins: process.env.WEB_URL ? [process.env.WEB_URL] : undefined,
})

try {
  await app.listen({ port, host })
  console.log(`api listening on ${host}:${port}`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
