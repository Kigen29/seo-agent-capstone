import type { ApiClient } from '@seo/api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  formatAuditChanges,
  formatAuditHistory,
  formatCompetitorWatch,
  formatKeywordGap,
  formatOutcomes,
  formatSchedule,
  formatVisibility,
} from '../format-reports.js'
import { guard } from './result.js'

/**
 * The report tools: the dashboard's later pages, for an agent.
 *
 * When the first tools were written the product was an inbox of findings and an audit. It has
 * since grown a history of audits, an AI-visibility report, an outcome report, a competitor watch
 * and a schedule, and an agent working through this server could see none of them. It could open
 * a pull request and could not find out whether the last one worked.
 *
 * All read-only except `keyword_gap`, which changes nothing and is still not marked read-only,
 * for the reason `keyword_ideas` is not: it is billed, and `readOnlyHint` is what a client uses
 * to decide what may run without asking.
 */

const siteId = z.string().uuid().describe('From list_sites.')
const READ = { readOnlyHint: true, openWorldHint: true } as const

export function registerReportTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'list_audits',
    {
      title: 'List a site’s audits',
      description:
        'Every audit of one site, newest first, each with how many findings it raised and what ' +
        'changed since the completed audit before it. Use this to find an audit id, then ' +
        'get_audit for its scorecard or audit_changes for what it resolved and raised.',
      inputSchema: { siteId },
      annotations: READ,
    },
    async ({ siteId: id }) => guard(async () => formatAuditHistory(await api.listSiteAudits(id))),
  )

  server.registerTool(
    'audit_changes',
    {
      title: 'What an audit resolved and raised',
      description:
        'One audit compared with the completed audit before it: which findings were resolved, ' +
        'which are new, and which scorecard areas moved. This is how to check that a merged fix ' +
        'actually removed its finding. Compared by finding identity, not by counting rows.',
      inputSchema: { auditId: z.string().uuid().describe('From list_audits or list_sites.') },
      annotations: READ,
    },
    async ({ auditId }) =>
      guard(async () => formatAuditChanges(await api.getAuditChanges(auditId))),
  )

  server.registerTool(
    'get_outcomes',
    {
      title: 'What became of each fix',
      description:
        'Every fix the agent has proposed for a site and what happened to it: waiting for ' +
        'review, merged and being checked, worked, or did not work, with the condition that was ' +
        'stated beforehand for calling it a failure. Includes the fixes that did not work. Call ' +
        'this before proposing another fix for the same site.',
      inputSchema: { siteId },
      annotations: READ,
    },
    async ({ siteId: id }) => guard(async () => formatOutcomes(await api.getOutcomes(id))),
  )

  server.registerTool(
    'get_visibility',
    {
      title: 'AI visibility report',
      description:
        'Whether AI answer engines cite the site, question by question, as "cited in k of N ' +
        'checks over D days". A question needs at least three checks on three different days ' +
        'before it has a verdict, because single checks are unreliable; "still checking" is not ' +
        'a negative result. Also returns share of voice against the named competitors.',
      inputSchema: { siteId },
      annotations: READ,
    },
    async ({ siteId: id }) =>
      guard(async () => formatVisibility(await api.getVisibilityReport(id))),
  )

  server.registerTool(
    'get_competitor_watch',
    {
      title: 'What competitors changed',
      description:
        'What each tracked competitor changed between weekly readings (titles, meta ' +
        'descriptions, main headings, new pages), beside their AI citations before and after. ' +
        'The citation counts are a coincidence in time and are not evidence that a change ' +
        'caused anything; do not report them as a cause.',
      inputSchema: { siteId },
      annotations: READ,
    },
    async ({ siteId: id }) =>
      guard(async () => formatCompetitorWatch(await api.getCompetitorWatch(id))),
  )

  server.registerTool(
    'get_schedule',
    {
      title: 'What runs for a site, and when',
      description:
        'A site’s calendar for one month: audits, the daily check of AI answers, the weekly ' +
        'reading of each competitor, and the traffic comparison after a fix. Past days show what ' +
        'ran; days ahead show what is due. Days are UTC days and a run happens at some point ' +
        'during its day, so do not promise a time. Scheduled audits are changed with ' +
        'set_audit_schedule.',
      inputSchema: {
        siteId,
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe('YYYY-MM. Defaults to this month. Up to twelve months either side.'),
      },
      annotations: READ,
    },
    async ({ siteId: id, month }) =>
      guard(async () => formatSchedule(await api.getSchedule(id, month))),
  )

  server.registerTool(
    'keyword_gap',
    {
      title: 'Searches a competitor ranks for and the site does not',
      description:
        'Keywords a named competitor appears for and this site does not, with monthly searches ' +
        'and the competitor’s position. Searches the site already appears for in its own Search ' +
        'Console are left out when that is connected. Note this is a BILLABLE query against a ' +
        'paid data source, so ask once with the limit you need.',
      inputSchema: {
        siteId,
        competitor: z.string().min(3).max(253).describe('The competitor’s domain, e.g. rival.com.'),
        country: z.string().length(2).optional().describe("ISO country code, e.g. 'ke'."),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      // Billed, so not marked read-only. See keyword_ideas for the reasoning.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => guard(async () => formatKeywordGap(await api.keywordGap(args))),
  )
}
