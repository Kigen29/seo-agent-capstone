#!/usr/bin/env node
import console from 'node:console'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/**
 * Drive the built MCP server the way an editor does, and say what came back.
 *
 * The unit tests run a real client against the tools over an in-memory transport. That covers
 * registration, validation and wording, and it does not cover the things that only exist in a
 * process: the entry point, the environment it reads, stdio as the transport, and a real API on
 * the other end. This starts `dist/server.js` as a child, speaks the protocol to it over its
 * stdin and stdout, and calls every tool that is free and changes nothing.
 *
 *   SEO_API_URL=... SEO_API_TOKEN=... pnpm --filter @seo/mcp smoke
 *
 * Read-only unless asked. With `--write` it also changes one site's audit schedule and changes
 * it straight back, which needs the server's own write switch as well:
 *
 *   SEO_MCP_ALLOW_WRITES=1 pnpm --filter @seo/mcp smoke -- --write
 *
 * It never calls a billed tool (`keyword_ideas`, `keyword_gap`) and never opens a pull request.
 * `SEO_SMOKE_SITE` picks the site; otherwise the first one listed is used.
 *
 * Exits 1 if any call fails, so it can gate a release.
 */

// `SEO_MCP_SERVER` points this at another build of the server: the bundle that gets published.
const server = process.env.SEO_MCP_SERVER
  ? resolve(process.env.SEO_MCP_SERVER)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../dist/server.js')
const write = process.argv.includes('--write')

if (!process.env.SEO_API_URL || !process.env.SEO_API_TOKEN) {
  console.error('Set SEO_API_URL and SEO_API_TOKEN first. Nothing was called.')
  process.exit(2)
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  // Only what the server reads. The rest of this shell's environment is none of its business.
  env: {
    PATH: process.env.PATH ?? '',
    SEO_API_URL: process.env.SEO_API_URL,
    SEO_API_TOKEN: process.env.SEO_API_TOKEN,
    SEO_MCP_ALLOW_WRITES: write ? (process.env.SEO_MCP_ALLOW_WRITES ?? '0') : '0',
  },
  stderr: 'pipe',
})
const client = new Client({ name: 'smoke', version: '0.0.0' })

let failed = 0
const firstLine = (text) => text.split('\n').find((line) => line.trim() !== '') ?? ''

async function call(name, args = {}) {
  const started = Date.now()
  try {
    const result = await client.callTool({ name, arguments: args })
    const text = result.content.map((part) => part.text ?? '').join('\n')
    const ok = result.isError !== true
    if (!ok) failed += 1
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${String(Date.now() - started).padStart(6)}ms  ${firstLine(text).slice(0, 110)}`,
    )
    return { ok, text }
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name.padEnd(22)} ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, text: '' }
  }
}

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  const names = tools.map((tool) => tool.name).sort()
  console.log(
    `${process.env.SEO_API_URL}: ${names.length} tools, writes ${write ? 'requested' : 'off'}`,
  )
  console.log(names.join(', '))
  console.log('')

  const sites = await call('list_sites')
  const ids = [
    ...sites.text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g),
  ].map((match) => match[0])
  const siteId = process.env.SEO_SMOKE_SITE ?? ids[0]

  if (!siteId) {
    console.log('\nThis account has no site, so the per-site tools were not called.')
  } else {
    console.log(`\nsite ${siteId}`)
    await call('list_findings', { siteId, pageSize: 5 })
    const audits = await call('list_audits', { siteId })
    const auditId = audits.text.match(/^\s+([0-9a-f-]{36})\s/m)?.[1]
    if (auditId) {
      await call('get_audit', { auditId })
      await call('audit_status', { auditId })
      await call('audit_changes', { auditId })
    }
    await call('get_outcomes', { siteId })
    await call('get_visibility', { siteId })
    await call('get_competitor_watch', { siteId })
    const schedule = await call('get_schedule', { siteId })

    if (write) {
      if (!names.includes('set_audit_schedule')) {
        failed += 1
        console.log(
          'FAIL set_audit_schedule     not offered: set SEO_MCP_ALLOW_WRITES=1 as well as --write',
        )
      } else {
        // Put back exactly what was there, whatever it was.
        const before = /Scheduled audits: every 7 days/.test(schedule.text)
          ? 'weekly'
          : /Scheduled audits: every 30 days/.test(schedule.text)
            ? 'monthly'
            : 'off'
        const other = before === 'weekly' ? 'monthly' : 'weekly'
        console.log(`\nschedule is "${before}"; changing to "${other}" and back`)
        await call('set_audit_schedule', { siteId, cadence: other })
        const changed = await call('get_schedule', { siteId })
        const expected = other === 'weekly' ? 'every 7 days' : 'every 30 days'
        if (!changed.text.includes(`Scheduled audits: ${expected}`)) {
          failed += 1
          console.log(`FAIL the schedule did not read back as ${expected}`)
        }
        await call('set_audit_schedule', { siteId, cadence: before })
      }
    }
  }
} catch (error) {
  failed += 1
  console.error(error instanceof Error ? error.message : String(error))
} finally {
  await client.close().catch(() => {})
}

console.log(failed === 0 ? '\nAll calls answered.' : `\n${failed} call(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
