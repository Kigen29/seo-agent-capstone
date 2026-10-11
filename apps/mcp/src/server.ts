#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createApiClient } from '@seo/api-client'
import { registerReadTools } from './tools/read.js'
import { registerReportTools } from './tools/reports.js'
import { writePermissions } from './permissions.js'
import { registerAccountTools } from './tools/account.js'
import { DEFAULT_MAX_PRS, registerRepositoryTools } from './tools/write.js'

/**
 * The MCP server: a second door to the product, for agents rather than browsers.
 *
 * It speaks to the REST API over HTTP exactly like the dashboard does, and holds no database
 * handle. That is not a convention here, it is enforced: the `DB_RULE` in eslint.config.mjs
 * restricts `@seo/db` to a five-entry allow-list that this app is deliberately not on, so a
 * future version of this file that tried to shortcut past the API would fail CI rather than
 * quietly put the owner credential (which carries BYPASSRLS) somewhere new. Tenancy needs no
 * new code for the same reason: the bearer token resolves to a tenant and row-level security
 * does the rest.
 *
 * stdio rather than HTTP, because the transport has to be free. Render's free tier fits one web
 * service and the API already occupies it, so a hosted transport would mean either paying or
 * evicting the API, and ADR-0006 says the whole thing runs at zero cost.
 */

/**
 * Well past Render's cold start.
 *
 * The API client defaults to 20 seconds, which is tuned for a person watching a page: past
 * that they assume it is broken, so failing fast is kinder than spinning. Nobody is watching
 * this one, and the free instance sleeps after ~15 minutes and takes 30 to 60 seconds to wake,
 * so the same default would turn every first call of the day into a spurious failure. A tool
 * that waits a minute is mildly annoying; a tool that reports the API is down when it is merely
 * asleep sends the reader off debugging the wrong thing.
 */
const TIMEOUT_MS = 90_000

function readEnv() {
  const baseUrl = process.env.SEO_API_URL
  const token = process.env.SEO_API_TOKEN

  if (!baseUrl || !token) {
    const missing = [!baseUrl && 'SEO_API_URL', !token && 'SEO_API_TOKEN'].filter(Boolean)
    throw new Error(
      `Missing ${missing.join(' and ')}. Set SEO_API_URL to the API's origin and SEO_API_TOKEN ` +
        'to a token from your account: sign in to RankWright, open Settings, Account and spend, ' +
        'and create one under Connect your editor.',
    )
  }

  const rawMax = Number(process.env.SEO_MCP_MAX_PRS)

  return {
    baseUrl,
    token,
    ...writePermissions(process.env),
    maxPrs: Number.isInteger(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_PRS,
  }
}

async function main(): Promise<void> {
  const env = readEnv()

  const api = createApiClient({
    baseUrl: env.baseUrl,
    token: env.token,
    timeoutMs: TIMEOUT_MS,
  })

  const server = new McpServer({ name: 'seo-agent', version: '0.3.0' })

  registerReadTools(server, api)
  registerReportTools(server, api)
  if (env.account) registerAccountTools(server, api)
  if (env.repository) registerRepositoryTools(server, api, { maxPrs: env.maxPrs })

  /**
   * stdout is the protocol. Anything written to it that is not JSON-RPC corrupts the stream and
   * the client disconnects, so every diagnostic in this process goes to stderr, and the token
   * goes to neither.
   */
  process.stderr.write(
    `seo-agent MCP: ${env.baseUrl}, account changes ${env.account ? 'on' : 'off'}, ` +
      `pull requests ${env.repository ? `on (max ${env.maxPrs})` : 'off'}\n`,
  )

  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
