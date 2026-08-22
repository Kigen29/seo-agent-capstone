import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from '@seo/api-client'
import { ApiRequestError } from '@seo/api-client'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerReadTools } from '../src/tools/read.js'
import { registerWriteTools } from '../src/tools/write.js'
import { AUDIT_ID, createFakeApi, FINDING_ROW_ID, SITE_ID, type Recorder } from './fake.js'

/**
 * The tools, driven through a real MCP client over an in-memory transport.
 *
 * Calling the callbacks directly would be simpler and would test less: it would skip the
 * registration, the schema validation, and the serialisation, which is most of what could go
 * wrong in wiring a protocol. This runs the actual client-server pair with no process and no
 * socket, so what these tests exercise is the path a real editor takes.
 */

interface Harness {
  client: Client
  recorder: Recorder
}

async function connect(options: {
  writes?: boolean
  maxPrs?: number
  api?: Partial<ApiClient>
}): Promise<Harness> {
  const { api, recorder } = createFakeApi(options.api ?? {})

  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerReadTools(server, api)
  if (options.writes) registerWriteTools(server, api, { maxPrs: options.maxPrs ?? 3 })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  return { client, recorder }
}

/** The text of a tool result, flattened. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[]
    isError?: boolean
  }

  return {
    text: result.content.map((part) => part.text ?? '').join('\n'),
    isError: result.isError === true,
  }
}

const names = async (client: Client): Promise<string[]> =>
  (await client.listTools()).tools.map((tool) => tool.name).sort()

describe('the tool surface', () => {
  it('lists only the read tools when writes are off', async () => {
    const { client } = await connect({ writes: false })

    expect(await names(client)).toEqual([
      'audit_status',
      'get_audit',
      'get_finding',
      'list_findings',
      'list_sites',
    ])
  })

  it('adds the write tools when writes are on', async () => {
    const { client } = await connect({ writes: true })

    expect(await names(client)).toContain('fix_finding')
    expect(await names(client)).toContain('verify_site')
    expect(await names(client)).toContain('run_audit')
  })

  it('never lists a tool without a description', async () => {
    // A tool a model cannot understand is a tool it will misuse. The description is the only
    // thing standing between "rowId" and a confidently-passed rule key.
    const { client } = await connect({ writes: true })
    const { tools } = await client.listTools()

    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy()
      expect(tool.inputSchema, `${tool.name} has no input schema`).toBeTruthy()
    }
  })

  it('marks every read tool read-only and no write tool read-only', async () => {
    const { client } = await connect({ writes: true })
    const { tools } = await client.listTools()

    const readOnly = (name: string) =>
      tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint

    expect(readOnly('list_sites')).toBe(true)
    expect(readOnly('get_finding')).toBe(true)
    expect(readOnly('fix_finding')).toBe(false)
    expect(readOnly('run_audit')).toBe(false)
  })
})

describe('read tools', () => {
  it('leads a findings row with the rowId, because that is what fix_finding takes', async () => {
    const { client } = await connect({})
    const { text } = await call(client, 'list_findings', { siteId: SITE_ID })

    expect(text).toContain(FINDING_ROW_ID)
    expect(text).toContain('TECH-005')
  })

  it('never puts affected URLs in a list response, only their count', async () => {
    // The inbox shipped full URL arrays once and it was megabytes per page. Into a context
    // window it is worse: it is paid for by the token and it crowds out the reasoning.
    const { client } = await connect({})
    const { text } = await call(client, 'list_findings', {})

    expect(text).toContain('2 affected URL(s)')
    expect(text).not.toContain('https://example.com/pricing')
  })

  it('gives the full evidence and the falsification condition for one finding', async () => {
    const { client } = await connect({})
    const { text } = await call(client, 'get_finding', { rowId: FINDING_ROW_ID })

    expect(text).toContain('head > meta[name="robots"]')
    expect(text).toContain('How we would know this fix failed')
    expect(text).toContain('https://example.com/pricing')
  })

  it('passes the filters through to the API rather than filtering locally', async () => {
    const { client, recorder } = await connect({})
    await call(client, 'list_findings', { axis: 'crawl_health', severity: 'critical', page: 2 })

    const listCall = recorder.calls.find((entry) => entry.method === 'listFindings')
    expect(listCall?.args[0]).toMatchObject({
      axis: 'crawl_health',
      severity: 'critical',
      page: 2,
    })
  })

  it('rejects a rule key where a rowId is required', async () => {
    // The mistake this is guarding: a finding's `id` is "TECH-005#0" and its `rowId` is a UUID.
    // The schema refuses the plausible-looking wrong one before it reaches the API.
    const { client } = await connect({})
    const result = await call(client, 'get_finding', { rowId: 'TECH-005#0' })

    expect(result.isError).toBe(true)
  })
})

describe('errors', () => {
  it('returns a readable result rather than a protocol error', async () => {
    const { client } = await connect({
      api: {
        listSites: async () => {
          throw new ApiRequestError(401, 'Unauthorized')
        },
      },
    })

    const result = await call(client, 'list_sites')

    expect(result.isError).toBe(true)
    expect(result.text).toContain('mint-token')
  })

  it('does not claim a 404 means the thing does not exist', async () => {
    const { client } = await connect({
      api: {
        getFinding: async () => {
          throw new ApiRequestError(404, 'Not Found')
        },
      },
    })

    const result = await call(client, 'get_finding', { rowId: FINDING_ROW_ID })

    expect(result.text).toContain('another tenant')
  })
})

describe('the pull-request cap', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await connect({ writes: true, maxPrs: 2 })
  })

  it('opens pull requests up to the cap', async () => {
    const first = await call(harness.client, 'fix_finding', { rowId: FINDING_ROW_ID })
    const second = await call(harness.client, 'fix_finding', { rowId: FINDING_ROW_ID })

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(harness.recorder.calls.filter((c) => c.method === 'fixFinding')).toHaveLength(2)
  })

  it('refuses past the cap, and does not call the API when it refuses', async () => {
    await call(harness.client, 'fix_finding', { rowId: FINDING_ROW_ID })
    await call(harness.client, 'fix_finding', { rowId: FINDING_ROW_ID })
    const third = await call(harness.client, 'fix_finding', { rowId: FINDING_ROW_ID })

    expect(third.text).toContain('limit')
    expect(third.text).toContain('SEO_MCP_MAX_PRS')
    // The refusal has to happen before the call, or the cap would be a report of a spend
    // already made rather than a guard against making it.
    expect(harness.recorder.calls.filter((c) => c.method === 'fixFinding')).toHaveLength(2)
  })

  it('shares one budget across both PR-opening tools', async () => {
    // Two separate budgets would let a loop open twice the agreed number by alternating, and a
    // human reviewer does not care which tool the fourth pull request came from.
    await call(harness.client, 'verify_site', { siteId: SITE_ID })
    await call(harness.client, 'fix_finding', { rowId: FINDING_ROW_ID })
    const third = await call(harness.client, 'verify_site', { siteId: SITE_ID })

    expect(third.text).toContain('limit')
    expect(harness.recorder.calls.filter((c) => c.method === 'verifySite')).toHaveLength(1)
  })

  it('does not count a failed fix against the cap', async () => {
    // Counted here rather than through the recorder: overriding the method replaces the
    // recording wrapper, so the shared recorder would never see these calls and an assertion
    // against it would be measuring the fake instead of the code.
    let attempts = 0

    const { client } = await connect({
      writes: true,
      maxPrs: 1,
      api: {
        fixFinding: async () => {
          attempts += 1
          throw new ApiRequestError(409, 'Connect a repository to this site first.')
        },
      },
    })

    const failed = await call(client, 'fix_finding', { rowId: FINDING_ROW_ID })
    expect(failed.isError).toBe(true)

    // A refusal that opened no pull request must not consume the budget for one, or a single
    // misconfigured site would exhaust the session without a single PR existing.
    const after = await call(client, 'fix_finding', { rowId: FINDING_ROW_ID })
    expect(after.text).not.toContain('limit')
    expect(attempts).toBe(2)
  })
})

describe('run_audit', () => {
  it('returns the audit id and says how to follow it', async () => {
    const { client } = await connect({ writes: true })
    const { text } = await call(client, 'run_audit', { siteId: SITE_ID })

    expect(text).toContain(AUDIT_ID)
    expect(text).toContain('audit_status')
  })
})
