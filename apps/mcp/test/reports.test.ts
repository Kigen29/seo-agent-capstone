import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  ApiClient,
  AuditChanges,
  CompetitorWatch,
  SiteOutcomes,
  SiteSchedule,
  VisibilityReport,
} from '@seo/api-client'
import { ApiRequestError } from '@seo/api-client'
import { describe, expect, it } from 'vitest'
import { registerReportTools } from '../src/tools/reports.js'
import { registerWriteTools } from '../src/tools/write.js'
import { AUDIT_ID, createFakeApi, FINDING_ROW_ID, SITE_ID, type Recorder } from './fake.js'

/**
 * The report tools, through a real MCP client over an in-memory transport.
 *
 * What is asserted is mostly wording, because for these tools the wording is the behaviour. A
 * model that is handed "33%" will repeat "33%"; one handed "2 of 6 checks" has the sample in
 * front of it. A model handed a competitor's change beside a citation count, with nothing
 * between them, will say one caused the other.
 */

async function connect(overrides: Partial<ApiClient> = {}, writes = false) {
  const { api, recorder } = createFakeApi(overrides)
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerReportTools(server, api)
  if (writes) registerWriteTools(server, api, { maxPrs: 3 })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, recorder: recorder as Recorder }
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

const visibility: VisibilityReport = {
  windowDays: 14,
  promptsConfigured: 3,
  promptsMeasured: 2,
  checksRun: 22,
  daysPolled: 5,
  engines: ['chatgpt', 'perplexity'],
  prompts: [
    {
      prompt: 'Who runs walking tours?',
      pollsRun: 10,
      daysPolled: 5,
      citedCount: 8,
      citationRate: 0.8,
      stability: 'stable',
    },
    {
      prompt: 'How much is a day trip?',
      pollsRun: 10,
      daysPolled: 5,
      citedCount: 3,
      citationRate: 0.3,
      stability: 'unstable',
    },
    {
      prompt: 'Is insurance included?',
      pollsRun: 2,
      daysPolled: 1,
      citedCount: 1,
      citationRate: 0.5,
      stability: 'insufficient',
    },
  ],
  share: {
    client: 12,
    clientShare: 0.55,
    competitors: [{ domain: 'rival.example', citations: 10 }],
  },
}

const outcomes: SiteOutcomes = {
  counts: { pr_open: 1, merged: 0, verified: 1, rejected: 1 },
  rates: {
    opened: 3,
    open: 1,
    merged: 2,
    closedUnmerged: 0,
    reverted: 0,
    mergeRate: 1,
    revertRate: 0,
  },
  outcomes: [
    {
      rowId: FINDING_ROW_ID,
      ruleId: 'TECH-005',
      title: '/about is noindexed but is in the sitemap',
      severity: 'high',
      status: 'rejected',
      prUrl: 'https://github.com/acme/site/pull/7',
      falsification: 'Re-crawl /about. If it still carries noindex, the fix failed.',
      baseline: null,
      verification: {
        outcome: 'rejected',
        verifiedAt: '2026-10-08T10:00:00.000Z',
        before: { capturedAt: '2026-10-01T00:00:00.000Z', metrics: [] },
        after: { capturedAt: '2026-10-08T00:00:00.000Z', metrics: [] },
        summary: 'TECH-005 still fires on 1 of the 1 page it flagged, so the fix did not work.',
      },
      note: null,
      affectedPages: 1,
    },
  ],
}

const changes: AuditChanges = {
  previous: { id: 'p', startedAt: '2026-10-01T09:00:00.000Z' },
  next: null,
  resolved: [
    {
      rowId: 'r1',
      ruleId: 'TECH-003',
      title: 'No sitemap declared',
      severity: 'medium',
      axis: 'crawl_health',
      status: 'verified',
      prUrl: null,
    },
  ],
  added: [],
  carried: 4,
  scores: [
    { axis: 'crawl_health', before: 67, after: 90 },
    { axis: 'content', before: 92, after: 92 },
  ],
  pages: { before: 48, after: 30 },
}

const watch: CompetitorWatch = {
  intervalDays: 7,
  windowDays: 7,
  competitors: [
    {
      domain: 'rival.example',
      lastSnapshotAt: '2026-10-07T03:00:00.000Z',
      pagesRead: 2,
      note: null,
    },
    { domain: 'new.example', lastSnapshotAt: null, pagesRead: 0, note: null },
  ],
  batches: [
    {
      competitor: 'rival.example',
      detectedAt: '2026-10-07T03:00:00.000Z',
      changes: [
        {
          kind: 'title',
          url: 'https://rival.example/pricing',
          before: 'Pricing',
          after: 'What a day costs',
        },
        { kind: 'new_url', url: 'https://rival.example/packing', before: null, after: null },
      ],
      citationsBefore: { cited: 2, checks: 16 },
      citationsAfter: { cited: 3, checks: 6 },
      afterComplete: false,
    },
  ],
}

const schedule: SiteSchedule = {
  month: '2026-10',
  from: '2026-09-28',
  to: '2026-11-01',
  today: '2026-10-10',
  auditCadence: 'weekly',
  events: [
    {
      id: 'audit:a',
      kind: 'audit',
      day: '2026-10-09',
      state: 'done',
      title: 'Audit',
      detail: '48 pages read and scored.',
    },
    {
      id: 'poll:10',
      kind: 'visibility_poll',
      day: '2026-10-10',
      state: 'due',
      title: 'AI answers check',
      detail: '5 questions.',
    },
    {
      id: 'poll:11',
      kind: 'visibility_poll',
      day: '2026-10-11',
      state: 'scheduled',
      title: 'AI answers check',
      detail: '5 questions.',
    },
    {
      id: 'poll:12',
      kind: 'visibility_poll',
      day: '2026-10-12',
      state: 'scheduled',
      title: 'AI answers check',
      detail: '5 questions.',
    },
    {
      id: 'audit:next',
      kind: 'audit',
      day: '2026-10-16',
      state: 'scheduled',
      title: 'Scheduled audit',
      detail: 'Runs every 7 days.',
    },
  ],
}

describe('the report tools', () => {
  it('are listed, described, and read-only unless they cost money', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'audit_changes',
      'get_competitor_watch',
      'get_outcomes',
      'get_schedule',
      'get_visibility',
      'keyword_gap',
      'list_audits',
    ])
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy()
      // A billed query is never something a client may run without asking.
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(tool.name !== 'keyword_gap')
    }
  })

  it('get_visibility keeps the sample on every figure, and gives no verdict on two checks', async () => {
    const { client, recorder } = await connect({ getVisibilityReport: async () => visibility })
    const { text, isError } = await call(client, 'get_visibility', { siteId: SITE_ID })

    expect(isError).toBe(false)
    expect(text).toContain('[cited] 8 of 10, 5 days: Who runs walking tours?')
    expect(text).toContain('[cited unstably] 3 of 10')
    expect(text).toContain('[still checking] 1 of 2, 1 day')
    expect(text).toContain('"Still checking" is not a negative result')
    // The only percentage is share of voice, which is stated beside its counts.
    expect(text.match(/\d+%/g)).toEqual(['55%'])
    expect(recorder.calls).toEqual([])
  })

  it('get_visibility says unmeasured, not zero, when nothing is tracked', async () => {
    const { client } = await connect({
      getVisibilityReport: async () => ({
        ...visibility,
        promptsConfigured: 0,
        prompts: [],
        share: null,
      }),
    })
    const { text } = await call(client, 'get_visibility', { siteId: SITE_ID })
    expect(text).toContain('not measured')
    expect(text).toContain('not a score of zero')
  })

  it('get_outcomes reports the fix that did not work, with what failure was defined as', async () => {
    const { client } = await connect({ getOutcomes: async () => outcomes })
    const { text } = await call(client, 'get_outcomes', { siteId: SITE_ID })

    expect(text).toContain('1 worked, 1 did not work')
    expect(text).toContain('[did not work] TECH-005')
    expect(text).toContain('It failed if: Re-crawl /about.')
    expect(text).toContain('https://github.com/acme/site/pull/7')
    expect(text).toContain('2 of 2 decided pull request(s) were merged')
  })

  it('audit_changes warns when fewer pages were reached, since that fakes a resolution', async () => {
    const { client } = await connect({ getAuditChanges: async () => changes })
    const { text } = await call(client, 'audit_changes', { auditId: AUDIT_ID })

    expect(text).toContain('1 resolved, 0 new, 4 still open')
    expect(text).toContain('crawl_health: 67 to 90')
    // An area that did not move is not listed.
    expect(text).not.toContain('content:')
    expect(text).toContain('reached 30 pages and the one before reached 48')
    expect(text).toContain('without having been fixed')
  })

  it('list_audits says first audit, not a comparison, when there is nothing before it', async () => {
    const { client } = await connect({
      listSiteAudits: async () => [
        {
          id: AUDIT_ID,
          status: 'complete',
          startedAt: '2026-10-09T12:00:00.000Z',
          completedAt: null,
          pagesCrawled: 48,
          error: null,
          scores: [],
          findings: 10,
          changes: { resolved: 1, added: 5 },
        },
        {
          id: 'older',
          status: 'complete',
          startedAt: '2026-10-01T12:00:00.000Z',
          completedAt: null,
          pagesCrawled: 46,
          error: null,
          scores: [],
          findings: 6,
          changes: null,
        },
      ],
    })
    const { text } = await call(client, 'list_audits', { siteId: SITE_ID })
    expect(text).toContain('2026-10-09  complete: 48 pages, 10 findings, 1 resolved, 5 new')
    expect(text).toContain('2026-10-01  complete: 46 pages, 6 findings, first audit')
  })

  it('get_competitor_watch never lets a change and a count stand as cause and effect', async () => {
    const { client } = await connect({ getCompetitorWatch: async () => watch })
    const { text } = await call(client, 'get_competitor_watch', { siteId: SITE_ID })

    expect(text).toContain('new.example: not read yet')
    expect(text).toContain(
      'title on https://rival.example/pricing: "Pricing" to "What a day costs"',
    )
    expect(text).toContain('2 of 16 checks')
    expect(text).toContain('3 of 6 in the 7 days after so far')
    expect(text).toContain('That is not evidence of a cause.')
    expect(text).not.toMatch(/because|led to|caused|thanks to|lift|%/i)
  })

  it('get_schedule folds the daily check into one line and promises no time of day', async () => {
    const { client, recorder } = await connect({
      getSchedule: async (...args: unknown[]) => {
        recorder.calls.push({ method: 'getSchedule', args })
        return schedule
      },
    } as Partial<ApiClient>)
    const { text } = await call(client, 'get_schedule', { siteId: SITE_ID, month: '2026-10' })

    expect(recorder.calls).toEqual([{ method: 'getSchedule', args: [SITE_ID, '2026-10'] }])
    expect(text).toContain('Scheduled audits: every 7 days.')
    expect(text).toContain('2026-10-10  [due today] AI answers check')
    expect(text).toContain('2026-10-11 to 2026-10-12  [scheduled, daily] AI answers check')
    expect(text.match(/AI answers check/g)).toHaveLength(2)
    expect(text).toContain('Already run:\n  2026-10-09  [done] Audit')
    expect(text).toContain('a run happens at some point during its day')
    expect(text).not.toMatch(/\d{2}:\d{2}/)
  })

  it('get_schedule refuses a month that is not one before it reaches the API', async () => {
    const { client, recorder } = await connect()
    const { isError } = await call(client, 'get_schedule', { siteId: SITE_ID, month: 'October' })
    expect(isError).toBe(true)
    expect(recorder.calls).toEqual([])
  })

  it('a site that is not the caller’s comes back as an explained failure, not a crash', async () => {
    const { client } = await connect({
      getOutcomes: async () => {
        throw new ApiRequestError(404, 'Not Found')
      },
    })
    const { isError, text } = await call(client, 'get_outcomes', { siteId: SITE_ID })
    expect(isError).toBe(true)
    expect(text).not.toBe('')
  })

  it('writes no em dash in anything it says', async () => {
    const { client } = await connect({
      getVisibilityReport: async () => visibility,
      getOutcomes: async () => outcomes,
      getAuditChanges: async () => changes,
      getCompetitorWatch: async () => watch,
      getSchedule: async () => schedule,
    })
    for (const [name, args] of [
      ['get_visibility', { siteId: SITE_ID }],
      ['get_outcomes', { siteId: SITE_ID }],
      ['audit_changes', { auditId: AUDIT_ID }],
      ['get_competitor_watch', { siteId: SITE_ID }],
      ['get_schedule', { siteId: SITE_ID }],
    ] as const) {
      expect((await call(client, name, args)).text, name).not.toContain('—')
    }
  })
})

describe('set_audit_schedule', () => {
  it('is not offered when writes are off', async () => {
    const { client } = await connect({}, false)
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).not.toContain('set_audit_schedule')
  })

  it('saves the interval, says what it now is, and opens no pull request', async () => {
    const saved: unknown[][] = []
    const { client, recorder } = await connect(
      {
        setAuditCadence: async (...args: unknown[]) => {
          saved.push(args)
          return 'weekly'
        },
      } as Partial<ApiClient>,
      true,
    )
    const { text, isError } = await call(client, 'set_audit_schedule', {
      siteId: SITE_ID,
      cadence: 'weekly',
    })
    expect(isError).toBe(false)
    expect(saved).toEqual([[SITE_ID, 'weekly']])
    expect(text).toContain('audited every 7 days')
    // It spends none of the session's pull request allowance.
    expect(recorder.calls.some((entry) => entry.method === 'fixFinding')).toBe(false)
    expect(text).not.toMatch(/pull requests used/)
  })

  it('refuses an interval that is not one of the three', async () => {
    const { client } = await connect({}, true)
    const { isError } = await call(client, 'set_audit_schedule', {
      siteId: SITE_ID,
      cadence: 'hourly',
    })
    expect(isError).toBe(true)
  })
})
