import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  ApiClient,
  CompetitorSuggestions,
  ContributorSearch,
  PromptSuggestions,
} from '@seo/api-client'
import { ApiRequestError } from '@seo/api-client'
import { describe, expect, it } from 'vitest'
import { registerSuggestionTools } from '../src/tools/suggest.js'
import { createFakeApi, SITE_ID } from './fake.js'

/**
 * The suggestion tools, through a real MCP client over an in-memory transport.
 *
 * Two things are asserted. That each tool asks the API for exactly what it was given and saves
 * nothing, and that each answer tells the model the list is a person's to choose from. The
 * second is wording, and for a tool whose result sits beside a tool that would act on it, the
 * wording is the control.
 */

const competitors: CompetitorSuggestions = {
  suggestions: [
    { domain: 'rivalsafaris.com', reason: 'Sells the same tours.', title: 'Rival Safaris' },
    { domain: 'untitled.example', reason: 'Same market.', title: null },
  ],
  dropped: 2,
  basedOn: { offering: true, market: true, homepage: false },
}

const questions: PromptSuggestions = {
  suggestions: [{ prompt: 'How much is a Kenya safari?', reason: 'The site sells them.' }],
  note: 'The homepage could not be read, so this leaned on the site details alone.',
}

const publications: ContributorSearch = {
  niche: 'Kenya safaris',
  opportunities: [
    {
      domain: 'travelweekly.example',
      url: 'https://travelweekly.example/write-for-us',
      title: 'Write for us',
      verdict: 'inviting',
      matched: ['write for us', 'contributor guidelines'],
      relevance: 0.8,
    },
  ],
  refused: [
    {
      domain: 'linkfarm.example',
      url: 'https://linkfarm.example/advertise',
      verdict: 'selling',
      matched: ['sponsored post $50'],
      relevance: 0.4,
    },
  ],
  queriesRun: 4,
}

async function connect(overrides: Partial<ApiClient> = {}) {
  const { api, recorder } = createFakeApi({
    suggestCompetitors: async () => competitors,
    suggestPrompts: async () => questions,
    findContributors: async () => publications,
    ...overrides,
  })
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSuggestionTools(server, api)

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, recorder }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[]
    isError?: boolean
  }
  return {
    text: result.content.map((part) => part.text ?? '').join('\n'),
    isError: result.isError === true,
  }
}

describe('the suggestion tools', () => {
  it('are three, each says it is billed, and none is marked safe to run unasked', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'find_publications',
      'suggest_competitors',
      'suggest_questions',
    ])
    for (const tool of tools) {
      expect(tool.description, tool.name).toContain('BILLED')
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false)
    }
  })

  it('save nothing: no call reaches the API but the one asked for', async () => {
    const seen: string[] = []
    const { client, recorder } = await connect({
      suggestCompetitors: async () => (seen.push('suggestCompetitors'), competitors),
      suggestPrompts: async () => (seen.push('suggestPrompts'), questions),
      findContributors: async () => (seen.push('findContributors'), publications),
    })

    await call(client, 'suggest_competitors', { siteId: SITE_ID })
    await call(client, 'suggest_questions', { siteId: SITE_ID })
    await call(client, 'find_publications', { siteId: SITE_ID, niche: 'Kenya safaris' })

    expect(seen).toEqual(['suggestCompetitors', 'suggestPrompts', 'findContributors'])
    // Everything else on the fake records itself, and nothing else was touched.
    expect(recorder.calls).toEqual([])
  })
})

describe('suggest_competitors', () => {
  it('shows each homepage title beside the reason, and what the draft was based on', async () => {
    const { client } = await connect()
    const { text } = await call(client, 'suggest_competitors', { siteId: SITE_ID })

    expect(text).toContain('2 suggested competitor(s)')
    expect(text).toContain('None has been saved')
    expect(text).toContain('Its homepage is titled: Rival Safaris')
    expect(text).toContain('Its homepage is titled: no title was found')
    expect(text).toContain('Drafted from what the site offers, its market.')
    expect(text).toContain('2 more were named and left out because they did not answer')
  })

  it('hands the choice to the person and names the tool that adds it', async () => {
    const { client } = await connect()
    const { text } = await call(client, 'suggest_competitors', { siteId: SITE_ID })

    expect(text).toContain('add only the ones they pick, with change_competitors')
  })

  it('says so when the site has no details to draft from', async () => {
    const { client } = await connect({
      suggestCompetitors: async () => ({
        suggestions: [],
        dropped: 0,
        basedOn: { offering: false, market: false, homepage: false },
      }),
    })
    const { text } = await call(client, 'suggest_competitors', { siteId: SITE_ID })

    expect(text).toContain('No competitor could be suggested')
    expect(text).toContain('Drafted from the address alone')
  })
})

describe('suggest_questions', () => {
  it('lists the questions, passes on the note, and says each one tracked is paid daily', async () => {
    const { client } = await connect()
    const { text } = await call(client, 'suggest_questions', { siteId: SITE_ID })

    expect(text).toContain('1 suggested question(s). None is tracked yet.')
    expect(text).toContain('How much is a Kenya safari?')
    expect(text).toContain('The homepage could not be read')
    expect(text).toContain('a paid check every day')
    expect(text).toContain('add_tracked_questions')
  })
})

describe('find_publications', () => {
  it('sends the niche and market it was given, and nothing it was not', async () => {
    let sent: unknown[] = []
    const { client } = await connect({
      findContributors: async (...args) => ((sent = args), publications),
    })
    await call(client, 'find_publications', {
      siteId: SITE_ID,
      niche: 'Kenya safaris',
      country: 'ke',
    })

    expect(sent).toEqual([SITE_ID, { niche: 'Kenya safaris', country: 'ke' }])
  })

  it('keeps the refused apart, with the phrases that decided each', async () => {
    const { client } = await connect()
    const { text } = await call(client, 'find_publications', {
      siteId: SITE_ID,
      niche: 'Kenya safaris',
    })

    expect(text).toContain('1 inviting contributions, 1 refused. 4 billed search(es) were run.')
    const [inviting, refused] = text.split('Refused, because they sell placements')
    expect(inviting).toContain('travelweekly.example: Write for us')
    expect(inviting).toContain('write for us; contributor guidelines')
    expect(inviting).not.toContain('linkfarm.example')
    expect(refused).toContain('linkfarm.example')
    expect(refused).toContain('sponsored post $50')
    expect(refused).toContain('not as options')
  })

  it('tells the model not to contact anybody', async () => {
    const { client } = await connect()
    const { text } = await call(client, 'find_publications', {
      siteId: SITE_ID,
      niche: 'Kenya safaris',
    })

    expect(text).toContain('a person sends it themselves')
    expect(text).toContain('do not write to these publications')
  })

  it('refuses a niche too short to search for before any search is billed', async () => {
    let asked = false
    const { client } = await connect({
      findContributors: async () => ((asked = true), publications),
    })
    const { isError } = await call(client, 'find_publications', { siteId: SITE_ID, niche: 'ab' })

    expect(isError).toBe(true)
    expect(asked).toBe(false)
  })

  it('passes on the reason when no data source is configured', async () => {
    const { client } = await connect({
      findContributors: async () => ({
        niche: 'Kenya safaris',
        opportunities: [],
        refused: [],
        queriesRun: 0,
        note: 'This needs a SERP data source, which is off by default.',
      }),
    })
    const { text } = await call(client, 'find_publications', {
      siteId: SITE_ID,
      niche: 'Kenya safaris',
    })

    expect(text).toContain('0 billed search(es) were run')
    expect(text).toContain('This needs a SERP data source')
  })
})

describe('when the allowance is spent', () => {
  it('reports the refusal as an error the model can read, not a crash', async () => {
    const { client } = await connect({
      suggestPrompts: async () => {
        throw new ApiRequestError(402, 'This month’s allowance has been used.')
      },
    })
    const { text, isError } = await call(client, 'suggest_questions', { siteId: SITE_ID })

    expect(isError).toBe(true)
    expect(text).toContain('allowance')
  })
})
