import type { ApiClient } from '@seo/api-client'
import { axisSchema, findingStatusSchema, severitySchema } from '@seo/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  formatAudit,
  formatFinding,
  formatFindingList,
  formatKeywordIdeas,
  formatProgress,
  formatSites,
} from '../format.js'
import { guard } from './result.js'

/**
 * The read tools: everything that observes and changes nothing.
 *
 * All five are annotated `readOnlyHint`, which is not decoration. A client can use it to decide
 * what may run without asking, and getting it wrong in the permissive direction is how an agent
 * ends up doing something irreversible on a user's behalf without a prompt.
 *
 * `openWorldHint` is true throughout: every one of these reaches a live API over the network,
 * so results are not reproducible from the arguments alone.
 */

/** The UUID the routes take. Named here once so every tool describes it the same way. */
const rowId = z
  .string()
  .uuid()
  .describe(
    'The finding\'s rowId (a UUID), from list_findings. Not the rule key like "TECH-007#0", ' +
      'which is a different identifier and will be rejected.',
  )

export function registerReadTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'list_sites',
    {
      title: 'List sites',
      description:
        'Every site in this tenant, with its connected repository, Search Console verification ' +
        'state, and latest audit. Start here: the siteId from this tool feeds every other one.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guard(async () => formatSites(await api.listSites())),
  )

  server.registerTool(
    'list_findings',
    {
      title: 'List findings',
      description:
        'The findings inbox, filtered and sorted by the server, highest priority first. ' +
        'Returns a count of affected URLs rather than the URLs themselves; use get_finding for ' +
        'the full evidence on a single finding.',
      inputSchema: {
        siteId: z.string().uuid().optional().describe('Narrow to one site, from list_sites.'),
        axis: axisSchema.optional().describe('One of the eight scorecard axes.'),
        severity: severitySchema.optional(),
        status: findingStatusSchema
          .optional()
          .describe('open, pr_open, merged, verified, rejected or wontfix.'),
        fixable: z
          .boolean()
          .optional()
          .describe('True for findings the agent can open a pull request for.'),
        q: z.string().optional().describe('Free text over the title and the rule id.'),
        sort: z.enum(['priority', 'severity', 'title', 'axis']).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => guard(async () => formatFindingList(await api.listFindings(args))),
  )

  server.registerTool(
    'get_finding',
    {
      title: 'Get one finding',
      description:
        'One finding in full: the evidence actually observed, every affected URL, and the ' +
        'falsification condition that says how we would know a fix had failed. This is the ' +
        'tool to call before deciding whether to fix something.',
      inputSchema: { rowId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ rowId: id }) => guard(async () => formatFinding(await api.getFinding(id))),
  )

  server.registerTool(
    'get_audit',
    {
      title: 'Get an audit',
      description:
        'One audit: its eight-axis scorecard and the titles of every finding it produced. ' +
        'There is deliberately no single overall score; the axes move independently.',
      inputSchema: {
        auditId: z.string().uuid().describe('From list_sites, or returned by run_audit.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ auditId }) => guard(async () => formatAudit(await api.getAudit(auditId))),
  )

  server.registerTool(
    'keyword_ideas',
    {
      title: 'Keyword ideas',
      description:
        'Keyword ideas related to a seed term, with monthly search volume, advertising ' +
        'competition and cost per click. Search volume is per-market, so pass the country you ' +
        'are writing for. Note this is a BILLABLE query against a paid data source, charged per ' +
        'request and per keyword returned, so ask once with the limit you need rather than ' +
        'repeatedly with small ones.',
      inputSchema: {
        seed: z.string().min(1).max(200).describe('The term to find ideas around.'),
        country: z
          .string()
          .length(2)
          .optional()
          .describe("ISO country code, e.g. 'ke'. Defaults to the United States."),
        language: z.string().min(2).max(5).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('How many ideas. Every row is billed, so this defaults to 50.'),
      },
      /**
       * Not marked read-only, although it modifies nothing.
       *
       * `readOnlyHint` is what a client uses to decide which tools are safe to run without asking,
       * and MCP has no annotation for "this costs money". Of the two available answers, the one
       * that lets an agent loop a billable query unattended is the worse mistake. The per-tenant
       * budget cap is the real control; this is the hint that stops it being reached by accident.
       */
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => guard(async () => formatKeywordIdeas(await api.keywordIdeas(args))),
  )

  server.registerTool(
    'audit_status',
    {
      title: 'Check audit progress',
      description:
        'Status and page count for an audit in flight. Cheap enough to poll every few seconds, ' +
        'unlike get_audit which carries every finding. Poll this after run_audit until it ' +
        'reports finished.',
      inputSchema: { auditId: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ auditId }) => guard(async () => formatProgress(await api.getAuditProgress(auditId))),
  )
}
