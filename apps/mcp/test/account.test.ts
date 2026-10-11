import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from '@seo/api-client'
import { ApiRequestError } from '@seo/api-client'
import { describe, expect, it } from 'vitest'
import { writePermissions } from '../src/permissions.js'
import { registerAccountTools } from '../src/tools/account.js'
import { registerReadTools } from '../src/tools/read.js'
import { registerReportTools } from '../src/tools/reports.js'
import { registerRepositoryTools } from '../src/tools/write.js'
import { createFakeApi, FINDING_ROW_ID, SITE_ID } from './fake.js'

/**
 * The account tools, and the two switches (ADR-0050).
 *
 * The property that matters most is the one an agent would break without meaning to: the API
 * replaces a list whole, so a tool that passed its argument straight through would let "add one
 * competitor" delete the other nine. Each test of a list checks what was sent to the API, not
 * only what the tool said.
 */

async function connect(
  permissions: { account?: boolean; repository?: boolean } = {},
  overrides: Partial<ApiClient> = {},
) {
  const { api, recorder } = createFakeApi(overrides)
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerReadTools(server, api)
  registerReportTools(server, api)
  if (permissions.account) registerAccountTools(server, api)
  if (permissions.repository) registerRepositoryTools(server, api, { maxPrs: 3 })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const names = async () => (await client.listTools()).tools.map((tool) => tool.name)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[]
      isError?: boolean
    }
    return {
      text: result.content.map((part) => part.text ?? '').join('\n'),
      isError: result.isError === true,
    }
  }
  const sent = (method: string) =>
    recorder.calls.filter((entry) => entry.method === method).map((entry) => entry.args)
  return { names, call, sent, client }
}

const ACCOUNT = [
  'add_site',
  'add_tracked_questions',
  'change_competitors',
  'connect_repository',
  'mark_not_us',
  'name_competitor',
  'run_audit',
  'set_audit_schedule',
  'set_finding_status',
  'update_site_details',
]
const REPOSITORY = ['fix_finding', 'verify_site']

describe('the two switches', () => {
  it('read the old single switch as both, so no existing setup loses a tool', () => {
    expect(writePermissions({ SEO_MCP_ALLOW_WRITES: '1' })).toEqual({
      account: true,
      repository: true,
    })
  })

  it('can be turned on one at a time', () => {
    expect(writePermissions({ SEO_MCP_ALLOW_ACCOUNT_WRITES: '1' })).toEqual({
      account: true,
      repository: false,
    })
    expect(writePermissions({ SEO_MCP_ALLOW_REPO_WRITES: '1' })).toEqual({
      account: false,
      repository: true,
    })
  })

  it('are off by default, and for anything that is not exactly 1', () => {
    expect(writePermissions({})).toEqual({ account: false, repository: false })
    for (const value of ['true', 'yes', 'on', '0', '', ' 1', 'TRUE']) {
      expect(
        writePermissions({
          SEO_MCP_ALLOW_WRITES: value,
          SEO_MCP_ALLOW_ACCOUNT_WRITES: value,
          SEO_MCP_ALLOW_REPO_WRITES: value,
        }),
        value,
      ).toEqual({ account: false, repository: false })
    }
  })

  it('offer no tool that changes anything when both are off', async () => {
    const { names } = await connect()
    for (const name of [...ACCOUNT, ...REPOSITORY]) expect(await names()).not.toContain(name)
  })

  it('offer the account tools without the pull request tools, and the other way round', async () => {
    const account = await (await connect({ account: true })).names()
    for (const name of ACCOUNT) expect(account, name).toContain(name)
    for (const name of REPOSITORY) expect(account, name).not.toContain(name)

    const repository = await (await connect({ repository: true })).names()
    for (const name of REPOSITORY) expect(repository, name).toContain(name)
    for (const name of ACCOUNT) expect(repository, name).not.toContain(name)
  })

  it('never mark a tool that changes something as read-only, and give every one a description', async () => {
    const { client } = await connect({ account: true, repository: true })
    const { tools } = await client.listTools()
    for (const name of [...ACCOUNT, ...REPOSITORY]) {
      const tool = tools.find((entry) => entry.name === name)
      expect(tool?.description, name).toBeTruthy()
      expect(tool?.annotations?.readOnlyHint, name).toBe(false)
      // Reversible settings and reviewable pull requests: nothing here destroys anything.
      expect(tool?.annotations?.destructiveHint, name).toBe(false)
    }
  })

  it('offer nothing that sends email, spends on billing, or handles a credential', async () => {
    const all = await (await connect({ account: true, repository: true })).names()
    for (const name of all) {
      expect(name).not.toMatch(
        /outreach|email|send|billing|checkout|token|credential|password|revoke/,
      )
    }
  })
})

describe('change_competitors', () => {
  it('adds one without dropping the others', async () => {
    const { call, sent } = await connect({ account: true })
    const { text, isError } = await call('change_competitors', {
      siteId: SITE_ID,
      add: ['new.example'],
    })
    expect(isError).toBe(false)
    expect(sent('saveCompetitors')).toEqual([
      [SITE_ID, ['rival.example', 'other.example', 'new.example']],
    ])
    expect(text).toContain('rival.example, other.example, new.example')
  })

  it('removes one and keeps the rest, and reduces an address to its domain', async () => {
    const { call, sent } = await connect({ account: true })
    await call('change_competitors', {
      siteId: SITE_ID,
      remove: ['https://www.Rival.example/pricing'],
      add: ['https://www.Third.example/about'],
    })
    expect(sent('saveCompetitors')).toEqual([[SITE_ID, ['other.example', 'third.example']]])
  })

  it('does not add one that is already there twice', async () => {
    const { call, sent } = await connect({ account: true })
    await call('change_competitors', { siteId: SITE_ID, add: ['rival.example', 'rival.example'] })
    expect(sent('saveCompetitors')).toEqual([[SITE_ID, ['rival.example', 'other.example']]])
  })

  it('writes nothing when given nothing', async () => {
    const { call, sent } = await connect({ account: true })
    const { text } = await call('change_competitors', { siteId: SITE_ID })
    expect(text).toMatch(/Nothing to do/)
    expect(sent('saveCompetitors')).toEqual([])
  })
})

describe('add_tracked_questions', () => {
  it('appends, keeps what was tracked, and leaves the other settings alone', async () => {
    const { call, sent } = await connect({ account: true })
    const { text } = await call('add_tracked_questions', {
      siteId: SITE_ID,
      questions: ['How much is a guided day trip?', 'who runs walking tours?'],
    })
    // The second is already tracked, in another case, and is not tracked twice.
    expect(sent('setVisibility')).toEqual([
      [
        SITE_ID,
        {
          prompts: ['Who runs walking tours?', 'How much is a guided day trip?'],
          competitors: ['rival.example'],
          brand: 'Acme',
        },
      ],
    ])
    expect(text).toContain('Added 1 question(s); 2 now tracked')
    expect(text).toContain('need three days before any verdict')
  })

  it('writes nothing when every question is already tracked', async () => {
    const { call, sent } = await connect({ account: true })
    const { text } = await call('add_tracked_questions', {
      siteId: SITE_ID,
      questions: ['Who runs walking tours?'],
    })
    expect(text).toMatch(/Nothing added/)
    expect(sent('setVisibility')).toEqual([])
  })

  it('refuses a long list, since each one is a paid check every day', async () => {
    const { call, sent } = await connect({ account: true })
    const eleven = Array.from({ length: 11 }, (_, index) => `Is question number ${index} tracked?`)
    expect(
      (await call('add_tracked_questions', { siteId: SITE_ID, questions: eleven })).isError,
    ).toBe(true)
    expect(sent('setVisibility')).toEqual([])
  })
})

describe('mark_not_us', () => {
  it('adds to the list, and takes one off it, without touching the rest', async () => {
    const { call, sent } = await connect({ account: true })
    await call('mark_not_us', { siteId: SITE_ID, domain: 'another.example', notUs: true })
    await call('mark_not_us', { siteId: SITE_ID, domain: 'same-name.example', notUs: false })
    expect(sent('saveMentionExclusions')).toEqual([
      [SITE_ID, ['same-name.example', 'another.example']],
      [SITE_ID, []],
    ])
  })
})

describe('update_site_details', () => {
  it('changes only what was given, sending the rest back as it was', async () => {
    const { call, sent } = await connect({ account: true })
    const { text } = await call('update_site_details', { siteId: SITE_ID, market: 'East Africa' })
    expect(sent('saveSiteProfile')).toEqual([
      [SITE_ID, { brand: 'Acme', offering: 'Guided walks', market: 'East Africa' }],
    ])
    expect(text).toContain('Market: East Africa')
  })

  it('writes nothing when given nothing to change', async () => {
    const { call, sent } = await connect({ account: true })
    expect((await call('update_site_details', { siteId: SITE_ID })).text).toMatch(/Nothing to do/)
    expect(sent('saveSiteProfile')).toEqual([])
  })
})

describe('the smaller tools', () => {
  it('name_competitor clears a name with an empty one', async () => {
    const { call, sent } = await connect({ account: true })
    await call('name_competitor', { siteId: SITE_ID, domain: 'rival.example', name: 'Rival Tours' })
    await call('name_competitor', { siteId: SITE_ID, domain: 'rival.example', name: '' })
    expect(sent('saveCompetitorName')).toEqual([
      [SITE_ID, 'rival.example', 'Rival Tours'],
      [SITE_ID, 'rival.example', null],
    ])
  })

  it('add_site supplies the scheme a person left off', async () => {
    const { call, sent } = await connect({ account: true })
    await call('add_site', { url: 'newsite.example' })
    await call('add_site', { url: 'http://plain.example' })
    expect(sent('addSite')).toEqual([['https://newsite.example'], ['http://plain.example']])
  })

  it('connect_repository takes owner/name and nothing that is not', async () => {
    const { call, sent } = await connect({ account: true })
    expect(
      (await call('connect_repository', { siteId: SITE_ID, repository: 'acme/site' })).isError,
    ).toBe(false)
    for (const bad of [
      'acme',
      'https://github.com/acme/site',
      'acme/site/extra',
      '../etc/passwd',
    ]) {
      expect(
        (await call('connect_repository', { siteId: SITE_ID, repository: bad })).isError,
        bad,
      ).toBe(true)
    }
    expect(sent('setSiteRepo')).toEqual([[SITE_ID, 'acme/site']])
  })

  it('set_finding_status dismisses and reopens, and nothing else', async () => {
    const { call, sent } = await connect({ account: true })
    expect(
      (await call('set_finding_status', { rowId: FINDING_ROW_ID, status: 'wontfix' })).text,
    ).toMatch(/dismissed/)
    expect(
      (await call('set_finding_status', { rowId: FINDING_ROW_ID, status: 'open' })).text,
    ).toMatch(/open again/)
    // An agent cannot mark a fix as having worked.
    expect(
      (await call('set_finding_status', { rowId: FINDING_ROW_ID, status: 'verified' })).isError,
    ).toBe(true)
    expect(sent('setFindingStatus')).toEqual([
      [FINDING_ROW_ID, 'wontfix'],
      [FINDING_ROW_ID, 'open'],
    ])
  })

  it('reports a refusal from the API in words, and not as a crash', async () => {
    const { call } = await connect(
      { account: true },
      {
        setFindingStatus: async () => {
          throw new ApiRequestError(
            409,
            'A pull request for this finding is open. Close or merge it first.',
          )
        },
      },
    )
    const { isError, text } = await call('set_finding_status', {
      rowId: FINDING_ROW_ID,
      status: 'wontfix',
    })
    expect(isError).toBe(true)
    expect(text).toContain('A pull request for this finding is open')
  })
})
